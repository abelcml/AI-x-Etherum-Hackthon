// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title VeilPoll — 무지의 베일 투표 (Algorithmica MVP)
 * @notice 커밋-리빌 방식으로 투표 중간집계를 은폐하여
 *         전략적 투표(프론트러닝/밴드왜건)를 원천 차단한다.
 *         롤즈의 "원초적 입장(Original Position)"의 기술적 구현.
 *
 * Phase 흐름:
 *   Commit  — keccak256(optionId, salt, voter) 해시만 제출. 아무도 표를 볼 수 없다.
 *   Reveal  — (optionId, salt) 공개로 자신의 커밋을 증명. 이때 집계된다.
 *   Ended   — reveal 마감 후 결과 확정.
 */
contract VeilPoll {
    enum Phase { Commit, Reveal, Ended }

    string[] private options;
    uint256[] private votes;

    uint256 public commitDeadline;   // 커밋 마감 시각
    uint256 public revealDeadline;   // 리빌 마감 시각

    mapping(address => bytes32) public commitments;  // voter → 커밋 해시
    mapping(address => bool) public revealed;        // voter → 리빌 여부

    uint256 public commitCount;
    uint256 public revealCount;

    event Committed(address indexed voter);
    event Revealed(address indexed voter, uint256 optionId);

    error WrongPhase(Phase expected, Phase actual);
    error AlreadyCommitted();
    error NoCommitment();
    error AlreadyRevealed();
    error BadReveal();
    error BadOption();

    constructor(
        string[] memory _options,
        uint256 commitDurationSec,
        uint256 revealDurationSec
    ) {
        require(_options.length >= 2, "need 2+ options");
        require(commitDurationSec > 0 && revealDurationSec > 0, "bad duration");
        options = _options;
        votes = new uint256[](_options.length);
        commitDeadline = block.timestamp + commitDurationSec;
        revealDeadline = commitDeadline + revealDurationSec;
    }

    // ───────────────────────── phase ─────────────────────────

    function currentPhase() public view returns (Phase) {
        if (block.timestamp < commitDeadline) return Phase.Commit;
        if (block.timestamp < revealDeadline) return Phase.Reveal;
        return Phase.Ended;
    }

    modifier onlyPhase(Phase p) {
        Phase now_ = currentPhase();
        if (now_ != p) revert WrongPhase(p, now_);
        _;
    }

    // ───────────────────────── commit ─────────────────────────

    /**
     * @notice 투표 커밋. 해시만 제출하므로 선택 내용은 은폐된다.
     * @param commitment keccak256(abi.encodePacked(optionId, salt, msg.sender))
     * @dev voter 주소를 해시에 포함시켜 타인의 커밋 복사(replay)를 차단한다.
     */
    function commitVote(bytes32 commitment) external onlyPhase(Phase.Commit) {
        if (commitments[msg.sender] != bytes32(0)) revert AlreadyCommitted();
        require(commitment != bytes32(0), "empty commitment");
        commitments[msg.sender] = commitment;
        commitCount += 1;
        emit Committed(msg.sender);
    }

    // ───────────────────────── reveal ─────────────────────────

    /**
     * @notice 커밋 공개. (optionId, salt)가 커밋 해시와 일치해야 집계된다.
     */
    function revealVote(uint256 optionId, bytes32 salt) external onlyPhase(Phase.Reveal) {
        bytes32 c = commitments[msg.sender];
        if (c == bytes32(0)) revert NoCommitment();
        if (revealed[msg.sender]) revert AlreadyRevealed();
        if (optionId >= options.length) revert BadOption();
        if (keccak256(abi.encodePacked(optionId, salt, msg.sender)) != c) revert BadReveal();

        revealed[msg.sender] = true;
        votes[optionId] += 1;
        revealCount += 1;
        emit Revealed(msg.sender, optionId);
    }

    // ───────────────────────── views ─────────────────────────

    function getOptions() external view returns (string[] memory) {
        return options;
    }

    /**
     * @notice 결과 조회. Ended 단계에서만 열람 가능 — 베일은 끝까지 유지된다.
     */
    function getResults() external view onlyPhase(Phase.Ended) returns (uint256[] memory) {
        return votes;
    }

    /// @notice 커밋 해시 생성 헬퍼 (오프체인 계산 권장, 온체인 호출 시 salt 노출 주의)
    function computeCommitment(uint256 optionId, bytes32 salt, address voter)
        external pure returns (bytes32)
    {
        return keccak256(abi.encodePacked(optionId, salt, voter));
    }
}
