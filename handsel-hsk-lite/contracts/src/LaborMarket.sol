// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface ICreditRegistry {
    function creditScore(address agent) external view returns (uint256);
}

/// @title LaborMarket
/// @notice An on-chain labor exchange for AI agents. A requester escrows USDC
///         for a job; a worker whose on-chain credit score clears the job's
///         threshold accepts and delivers it; on approval the escrow is
///         released. Completion is the demand side of the credit system — it
///         is the economic activity that credit funds and that reputation is
///         earned from.
///
///         Money and state live here; human-readable job specs live off-chain,
///         referenced by specHash.
///
///         If the requester disputes a submission instead of approving it,
///         the job locks in Disputed status until `arbiter` — a fixed address
///         set at deploy time, independent of both parties — calls
///         resolveDispute() to force a settlement either way.
contract LaborMarket {
    IERC20 public immutable usdc;
    ICreditRegistry public immutable registry;
    address public immutable arbiter;

    enum Status {
        Open,
        Accepted,
        Submitted,
        Completed,
        Cancelled,
        Disputed,
        Refunded
    }

    struct Job {
        address requester;
        address worker;
        uint256 bounty;
        uint256 minScore; // required worker credit score (0 = open to all)
        Status status;
        bytes32 specHash;
        bytes32 resultHash;
    }

    uint256 public jobCount;
    mapping(uint256 => Job) public jobs;

    event JobPosted(uint256 indexed jobId, address indexed requester, uint256 bounty, uint256 minScore, bytes32 specHash);
    event JobAccepted(uint256 indexed jobId, address indexed worker, uint256 workerScore);
    event WorkSubmitted(uint256 indexed jobId, bytes32 resultHash);
    event JobCompleted(uint256 indexed jobId, address indexed worker, address indexed requester, uint256 bounty);
    event JobCancelled(uint256 indexed jobId);
    event JobDisputed(uint256 indexed jobId, address indexed raisedBy);
    event DisputeResolved(uint256 indexed jobId, bool releasedToWorker);

    error WrongStatus();
    error NotRequester();
    error NotWorker();
    error NotArbiter();
    error ScoreTooLow(uint256 have, uint256 need);
    error SelfWork();

    constructor(address _usdc, address _registry, address _arbiter) {
        usdc = IERC20(_usdc);
        registry = ICreditRegistry(_registry);
        arbiter = _arbiter;
    }

    /// @notice Post a job, escrowing `bounty` USDC. Requester must approve
    ///         this contract for `bounty` first (batch it in the same UserOp).
    function postJob(uint256 bounty, uint256 minScore, bytes32 specHash) external returns (uint256 jobId) {
        require(usdc.transferFrom(msg.sender, address(this), bounty), "escrow: transferFrom");
        jobId = ++jobCount;
        jobs[jobId] = Job({
            requester: msg.sender,
            worker: address(0),
            bounty: bounty,
            minScore: minScore,
            status: Status.Open,
            specHash: specHash,
            resultHash: bytes32(0)
        });
        emit JobPosted(jobId, msg.sender, bounty, minScore, specHash);
    }

    /// @notice Accept an open job. Reputation-gated: the worker's on-chain
    ///         credit score must meet the job's threshold. This is where
    ///         creditworthiness decides who can take on which work.
    function acceptJob(uint256 jobId) external {
        Job storage job = jobs[jobId];
        if (job.status != Status.Open) revert WrongStatus();
        if (msg.sender == job.requester) revert SelfWork();

        uint256 score = registry.creditScore(msg.sender);
        if (score < job.minScore) revert ScoreTooLow(score, job.minScore);

        job.worker = msg.sender;
        job.status = Status.Accepted;
        emit JobAccepted(jobId, msg.sender, score);
    }

    /// @notice Worker submits the deliverable (referenced off-chain by hash).
    function submitWork(uint256 jobId, bytes32 resultHash) external {
        Job storage job = jobs[jobId];
        if (job.status != Status.Accepted) revert WrongStatus();
        if (msg.sender != job.worker) revert NotWorker();
        job.resultHash = resultHash;
        job.status = Status.Submitted;
        emit WorkSubmitted(jobId, resultHash);
    }

    /// @notice Requester approves the work; escrow is released to the worker.
    ///         The off-chain layer turns JobCompleted into a reputation event
    ///         that raises the worker's credit score.
    function approveJob(uint256 jobId) external {
        Job storage job = jobs[jobId];
        if (job.status != Status.Submitted) revert WrongStatus();
        if (msg.sender != job.requester) revert NotRequester();

        job.status = Status.Completed;
        require(usdc.transfer(job.worker, job.bounty), "release: transfer");
        emit JobCompleted(jobId, job.worker, job.requester, job.bounty);
    }

    /// @notice Requester disputes a submission instead of approving it. Locks
    ///         the escrow until the arbiter resolves it — the requester alone
    ///         can no longer unilaterally withhold payment forever.
    function raiseDispute(uint256 jobId) external {
        Job storage job = jobs[jobId];
        if (job.status != Status.Submitted) revert WrongStatus();
        if (msg.sender != job.requester) revert NotRequester();

        job.status = Status.Disputed;
        emit JobDisputed(jobId, msg.sender);
    }

    /// @notice Arbiter (independent of requester and worker) settles a
    ///         disputed job by reviewing the deliverable against the spec:
    ///         true releases escrow to the worker, false refunds the requester.
    function resolveDispute(uint256 jobId, bool releaseToWorker) external {
        Job storage job = jobs[jobId];
        if (job.status != Status.Disputed) revert WrongStatus();
        if (msg.sender != arbiter) revert NotArbiter();

        if (releaseToWorker) {
            job.status = Status.Completed;
            require(usdc.transfer(job.worker, job.bounty), "release: transfer");
            emit JobCompleted(jobId, job.worker, job.requester, job.bounty);
        } else {
            job.status = Status.Refunded;
            require(usdc.transfer(job.requester, job.bounty), "refund: transfer");
        }
        emit DisputeResolved(jobId, releaseToWorker);
    }

    /// @notice Requester cancels an unaccepted job and reclaims the escrow.
    function cancelJob(uint256 jobId) external {
        Job storage job = jobs[jobId];
        if (job.status != Status.Open) revert WrongStatus();
        if (msg.sender != job.requester) revert NotRequester();

        job.status = Status.Cancelled;
        require(usdc.transfer(job.requester, job.bounty), "refund: transfer");
        emit JobCancelled(jobId);
    }
}
