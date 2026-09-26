// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {LaborMarket} from "../src/LaborMarket.sol";

/// @notice Redeploys ONLY LaborMarket, wired to the already-deployed
///         MockUSDC and AgentCreditRegistry. Use this when LaborMarket.sol
///         changes on its own (e.g. adding dispute resolution) — every other
///         contract, and everything they hold (agent USDC balances, credit
///         lines, verified-task escrow), is untouched.
///
/// Usage:
///   forge script script/DeployLaborMarket.s.sol \
///     --rpc-url sepolia --broadcast --verify \
///     --private-key $DEPLOYER_PRIVATE_KEY
///
/// Env:
///   MOCK_USDC_ADDRESS        existing MockUSDC contract
///   CREDIT_REGISTRY_ADDRESS  existing AgentCreditRegistry contract
///   ORACLE_ADDRESS           becomes the dispute arbiter
contract DeployLaborMarket is Script {
    function run() external {
        address usdc = vm.envAddress("MOCK_USDC_ADDRESS");
        address registry = vm.envAddress("CREDIT_REGISTRY_ADDRESS");
        address oracle = vm.envAddress("ORACLE_ADDRESS");

        vm.startBroadcast();
        LaborMarket labor = new LaborMarket(usdc, registry, oracle);
        vm.stopBroadcast();

        console.log("LaborMarket (new):  ", address(labor));
        console.log("  usdc:             ", usdc);
        console.log("  registry:         ", registry);
        console.log("  arbiter (oracle): ", oracle);
        console.log("");
        console.log("Set LABOR_MARKET_ADDRESS to the address above in Vercel, then redeploy.");
    }
}
