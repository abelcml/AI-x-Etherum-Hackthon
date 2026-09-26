// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

interface ICreditRegistry {
    function creditLimit(address agent) external view returns (uint256);
}

/// @title AgentCreditVault
/// @notice Lends test USDC to agent smart accounts up to the credit limit
///         published in the registry. `draw` is called by the agent's own
///         ERC-4337 account (msg.sender == the agent), so the credit limit
///         earned from behavior is enforced on-chain — the "credit lets
///         agents scale" thesis made real.
contract AgentCreditVault {
    IERC20 public immutable usdc;
    ICreditRegistry public immutable registry;

    /// @dev agent => currently outstanding (drawn, not repaid) balance
    mapping(address => uint256) public outstanding;

    event Drawn(address indexed agent, uint256 amount, uint256 outstanding);
    event Repaid(address indexed agent, uint256 amount, uint256 outstanding);

    error ExceedsLimit(uint256 requested, uint256 available);
    error NothingToRepay();
    error VaultInsufficient();

    constructor(address _usdc, address _registry) {
        usdc = IERC20(_usdc);
        registry = ICreditRegistry(_registry);
    }

    /// @notice Available headroom for an agent = limit − outstanding.
    function available(address agent) public view returns (uint256) {
        uint256 limit = registry.creditLimit(agent);
        uint256 drawn = outstanding[agent];
        return limit > drawn ? limit - drawn : 0;
    }

    /// @notice Draw credit. Enforced against the on-chain limit; USDC is sent
    ///         to the calling agent account.
    function draw(uint256 amount) external {
        uint256 headroom = available(msg.sender);
        if (amount > headroom) revert ExceedsLimit(amount, headroom);
        if (usdc.balanceOf(address(this)) < amount) revert VaultInsufficient();

        outstanding[msg.sender] += amount;
        require(usdc.transfer(msg.sender, amount), "vault: transfer");
        emit Drawn(msg.sender, amount, outstanding[msg.sender]);
    }

    /// @notice Repay drawn credit. The agent must approve the vault first.
    function repay(uint256 amount) external {
        uint256 drawn = outstanding[msg.sender];
        if (drawn == 0) revert NothingToRepay();
        uint256 pay = amount > drawn ? drawn : amount;

        outstanding[msg.sender] -= pay;
        require(usdc.transferFrom(msg.sender, address(this), pay), "vault: transferFrom");
        emit Repaid(msg.sender, pay, outstanding[msg.sender]);
    }
}
