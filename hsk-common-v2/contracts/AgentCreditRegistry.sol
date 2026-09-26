// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title AgentCreditRegistry
/// @notice On-chain source of truth for each agent's credit limit. The
///         off-chain scoring engine (the "oracle") mirrors every recalculated
///         limit here; the CreditVault reads it to enforce spending. This is
///         the bridge between behavioral reputation and on-chain capacity.
contract AgentCreditRegistry {
    address public oracle; // backend key that publishes credit limits

    /// @dev agent smart-account address => credit limit (in USDC's 6 decimals)
    mapping(address => uint256) public creditLimit;
    /// @dev latest score/rating mirrored for on-chain readers (informational)
    mapping(address => uint256) public creditScore;

    event OracleTransferred(address indexed previousOracle, address indexed newOracle);
    event LimitUpdated(address indexed agent, uint256 limit, uint256 score);

    error NotOracle();

    constructor(address _oracle) {
        oracle = _oracle;
        emit OracleTransferred(address(0), _oracle);
    }

    modifier onlyOracle() {
        if (msg.sender != oracle) revert NotOracle();
        _;
    }

    function setOracle(address newOracle) external onlyOracle {
        emit OracleTransferred(oracle, newOracle);
        oracle = newOracle;
    }

    /// @notice Publish an agent's recalculated credit limit and score.
    function setLimit(address agent, uint256 limit, uint256 score) external onlyOracle {
        creditLimit[agent] = limit;
        creditScore[agent] = score;
        emit LimitUpdated(agent, limit, score);
    }
}
