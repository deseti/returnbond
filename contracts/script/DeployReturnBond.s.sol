// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {ReturnBond} from "../src/ReturnBond.sol";

/// @notice Deploys ReturnBond using the account selected through Foundry's keystore flow.
contract DeployReturnBond is Script {
    function run() external returns (ReturnBond deployment) {
        vm.startBroadcast();
        deployment = new ReturnBond();
        vm.stopBroadcast();
    }
}
