export const MOZI_TREASURY_HUB_ABI = [
  "function setAgent(address agent, bool allowed) external",
  "function proposeOrderFor(address owner,address supplier,uint256 amount,uint64 executeAfter,bytes32 ref,bytes32 restaurantId) external returns (uint256)",
  "function executeOrder(uint256 orderId) external",
  "function availableToWithdraw(address owner) view returns (uint256)",
  "function reservedOf(address owner) view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
] as const;
