// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./VeilPoll.sol";

/**
 * @title VeilPollFactory
 * @notice VeilPoll 인스턴스를 반복 생성하는 팩토리.
 *         v1은 "1 컨트랙트 = 1 투표"였던 한계를 해소한다.
 */
contract VeilPollFactory {
    address[] public polls;

    event PollCreated(
        address indexed poll,
        address indexed creator,
        uint256 commitDeadline,
        uint256 revealDeadline
    );

    /**
     * @notice 새 VeilPoll 투표를 생성한다.
     * @param options 선택지 (2개 이상)
     * @param commitDurationSec 커밋 기간(초)
     * @param revealDurationSec 리빌 기간(초)
     * @return poll 생성된 VeilPoll 인스턴스 주소
     */
    function createPoll(
        string[] memory options,
        uint256 commitDurationSec,
        uint256 revealDurationSec
    ) external returns (address poll) {
        VeilPoll newPoll = new VeilPoll(options, commitDurationSec, revealDurationSec);
        poll = address(newPoll);
        polls.push(poll);

        emit PollCreated(poll, msg.sender, newPoll.commitDeadline(), newPoll.revealDeadline());
    }

    function getPolls() external view returns (address[] memory) {
        return polls;
    }

    function pollCount() external view returns (uint256) {
        return polls.length;
    }
}
