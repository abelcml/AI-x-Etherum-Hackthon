// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {AgentCreditRegistry} from "../src/AgentCreditRegistry.sol";
import {AgentCreditVault} from "../src/AgentCreditVault.sol";
import {LaborMarket} from "../src/LaborMarket.sol";
import {VerifiedTaskEscrow} from "../src/VerifiedTaskEscrow.sol";

/// @notice Deploys the credit stack to Sepolia and seeds the vault with test USDC.
///
/// Usage:
///   forge script script/Deploy.s.sol \
///     --rpc-url sepolia --broadcast --verify \
///     --private-key $DEPLOYER_PRIVATE_KEY
///
/// Env:
///   ORACLE_ADDRESS   backend key allowed to publish credit limits
///   VAULT_SEED_USDC  human units to mint into the vault (default 1,000,000)
contract Deploy is Script {
    function run() external {
        address oracle = vm.envAddress("ORACLE_ADDRESS");
        uint256 seed = vm.envOr("VAULT_SEED_USDC", uint256(1_000_000));

        vm.startBroadcast();

        MockUSDC usdc = new MockUSDC();
        AgentCreditRegistry registry = new AgentCreditRegistry(oracle);
        AgentCreditVault vault = new AgentCreditVault(address(usdc), address(registry));
        LaborMarket labor = new LaborMarket(address(usdc), address(registry), oracle);
        VerifiedTaskEscrow verified = new VerifiedTaskEscrow(address(usdc), address(registry));

        // Fund the vault so agents can actually draw (6-decimal token).
        usdc.mint(address(vault), seed * 1e6);

        vm.stopBroadcast();

        console.log("MockUSDC:            ", address(usdc));
        console.log("AgentCreditRegistry: ", address(registry));
        console.log("AgentCreditVault:    ", address(vault));
        console.log("LaborMarket:         ", address(labor));
        console.log("VerifiedTaskEscrow:  ", address(verified));
        console.log("Oracle:              ", oracle);
    }
}
