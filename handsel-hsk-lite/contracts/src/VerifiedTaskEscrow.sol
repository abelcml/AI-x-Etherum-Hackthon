// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface ICreditRegistry {
    function creditScore(address agent) external view returns (uint256);
}

/// @title VerifiedTaskEscrow
/// @notice Escrow released by VERIFICATION, not approval. A requester posts a
///         task whose correct answer is committed as a hash; a solver agent
///         (credit-gated) commits to its answer, then reveals it. If the
///         revealed answer hashes to the requester's answerHash the escrow
///         pays out automatically — no human approver, no self-evaluation.
///
///         Commit-reveal prevents mempool front-running: commitAnswer binds
///         the task to the solver before the answer ever appears on-chain,
///         so a copied reveal is worthless to anyone else.
contract VerifiedTaskEscrow {
    IERC20 public immutable usdc;
    ICreditRegistry public immutable registry;

    uint256 public constant REVEAL_WINDOW = 1 hours;

    enum Status {
        Open,
        Committed,
        Completed,
        Cancelled
    }

    struct Task {
        address requester;
        address solver;
        uint256 bounty;
        uint256 minScore;
        bytes32 specHash; // off-chain problem statement
        bytes32 answerHash; // keccak256(bytes(answer))
        bytes32 commitment; // keccak256(taskId, solver, salt, answer)
        uint256 revealDeadline;
        Status status;
    }

    uint256 public taskCount;
    mapping(uint256 => Task) public tasks;

    event TaskPosted(uint256 indexed taskId, address indexed requester, uint256 bounty, uint256 minScore, bytes32 specHash);
    event AnswerCommitted(uint256 indexed taskId, address indexed solver, uint256 revealDeadline);
    event TaskCompleted(uint256 indexed taskId, address indexed solver, uint256 bounty);
    event RevealFailed(uint256 indexed taskId, address indexed solver); // wrong answer — task reopens
    event CommitExpired(uint256 indexed taskId, address indexed solver);
    event TaskCancelled(uint256 indexed taskId);

    error WrongStatus();
    error NotRequester();
    error NotSolver();
    error ScoreTooLow(uint256 have, uint256 need);
    error BadCommitment();
    error NotExpired();
    error SelfSolve();

    constructor(address _usdc, address _registry) {
        usdc = IERC20(_usdc);
        registry = ICreditRegistry(_registry);
    }

    /// @notice Escrow `bounty` and post a task. Requester must approve first
    ///         (batched in the same UserOp by the app).
    function postTask(uint256 bounty, uint256 minScore, bytes32 specHash, bytes32 answerHash)
        external
        returns (uint256 taskId)
    {
        require(usdc.transferFrom(msg.sender, address(this), bounty), "escrow: transferFrom");
        taskId = ++taskCount;
        tasks[taskId] = Task({
            requester: msg.sender,
            solver: address(0),
            bounty: bounty,
            minScore: minScore,
            specHash: specHash,
            answerHash: answerHash,
            commitment: bytes32(0),
            revealDeadline: 0,
            status: Status.Open
        });
        emit TaskPosted(taskId, msg.sender, bounty, minScore, specHash);
    }

    /// @notice Credit-gated commit: binds the task to the solver before any
    ///         answer is visible on-chain.
    function commitAnswer(uint256 taskId, bytes32 commitment) external {
        Task storage task = tasks[taskId];
        if (task.status != Status.Open) revert WrongStatus();
        if (msg.sender == task.requester) revert SelfSolve();

        uint256 score = registry.creditScore(msg.sender);
        if (score < task.minScore) revert ScoreTooLow(score, task.minScore);

        task.solver = msg.sender;
        task.commitment = commitment;
        task.revealDeadline = block.timestamp + REVEAL_WINDOW;
        task.status = Status.Committed;
        emit AnswerCommitted(taskId, msg.sender, task.revealDeadline);
    }

    /// @notice Reveal the answer. Correct → escrow pays the solver instantly.
    ///         Wrong → the task reopens (failure is public and permanent in
    ///         the event log, which the credit layer consumes).
    function revealAnswer(uint256 taskId, string calldata answer, bytes32 salt) external {
        Task storage task = tasks[taskId];
        if (task.status != Status.Committed) revert WrongStatus();
        if (msg.sender != task.solver) revert NotSolver();

        bytes32 expected = keccak256(abi.encodePacked(taskId, msg.sender, salt, bytes(answer)));
        if (expected != task.commitment) revert BadCommitment();

        if (keccak256(bytes(answer)) == task.answerHash) {
            task.status = Status.Completed;
            require(usdc.transfer(task.solver, task.bounty), "payout: transfer");
            emit TaskCompleted(taskId, task.solver, task.bounty);
        } else {
            emit RevealFailed(taskId, task.solver);
            task.solver = address(0);
            task.commitment = bytes32(0);
            task.revealDeadline = 0;
            task.status = Status.Open;
        }
    }

    /// @notice Anyone may reopen a committed task whose solver never revealed.
    function reclaimExpired(uint256 taskId) external {
        Task storage task = tasks[taskId];
        if (task.status != Status.Committed) revert WrongStatus();
        if (block.timestamp <= task.revealDeadline) revert NotExpired();

        emit CommitExpired(taskId, task.solver);
        task.solver = address(0);
        task.commitment = bytes32(0);
        task.revealDeadline = 0;
        task.status = Status.Open;
    }

    /// @notice Requester reclaims escrow from an open (unclaimed) task.
    function cancelTask(uint256 taskId) external {
        Task storage task = tasks[taskId];
        if (task.status != Status.Open) revert WrongStatus();
        if (msg.sender != task.requester) revert NotRequester();

        task.status = Status.Cancelled;
        require(usdc.transfer(task.requester, task.bounty), "refund: transfer");
        emit TaskCancelled(taskId);
    }
}
