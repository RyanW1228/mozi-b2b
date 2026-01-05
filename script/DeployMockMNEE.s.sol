// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../contracts/MockMNEE.sol";

contract DeployMockMNEE is Script {
    function run() external {
        vm.startBroadcast();
        MockMNEE token = new MockMNEE();
        vm.stopBroadcast();

        console2.log("MockMNEE deployed at:", address(token));
    }
}
