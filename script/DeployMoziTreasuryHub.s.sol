// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import {MoziTreasuryHub} from "../contracts/MoziTreasuryHub.sol";

contract DeployMoziTreasuryHub is Script {
    function run() external returns (MoziTreasuryHub hub) {
        address tokenAddr = vm.envAddress("MAINNET_MNEE_TOKEN");

        vm.startBroadcast(vm.envUint("MAINNET_PRIVATE_KEY"));
        hub = new MoziTreasuryHub(tokenAddr);
        vm.stopBroadcast();
    }
}
