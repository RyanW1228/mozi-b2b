export const MOZI_TREASURY_HUB_ABI = [
  "function setAgent(address agent, bool allowed) external",
  "function isAgentFor(address owner, address agent) view returns (bool)",

  "function setRequireApprovalForExecution(bool required) external",
  "function requireApprovalForExecution(address owner) view returns (bool)",
  "function setIntentApproval(bytes32 ref, bool approved) external",
  "function isIntentApproved(address owner, bytes32 ref) view returns (bool)",

  "function proposeOrderFor(address owner,address supplier,uint256 amount,uint64 executeAfter,bytes32 ref,bytes32 restaurantId) external returns (uint256)",
  "function executeOrder(uint256 orderId) external",
  "function cancelOrder(uint256 orderId) external", // ✅ ADD THIS

  "function availableToWithdraw(address owner) view returns (uint256)",
  "function reservedOf(address owner) view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",

  "function nextOrderId() view returns (uint256)",
  "function pendingOrders(uint256) view returns (address owner,address supplier,uint256 amount,uint64 executeAfter,bool canceled,bool executed,bytes32 ref,bytes32 restaurantId)",
] as const;
