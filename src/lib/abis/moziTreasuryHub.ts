export const MOZI_TREASURY_HUB_ABI = [
  "function setAgent(address agent, bool allowed) external",
  "function isAgentFor(address owner, address agent) view returns (bool)",

  "function setRequireApprovalForExecution(bool required) external",
  "function requireApprovalForExecution(address owner) view returns (bool)",

  "function setIntentApproval(bytes32 ref, bool approved) external",
  "function isIntentApproved(address owner, bytes32 ref) view returns (bool)",

  // NEW: immediate payment (no pending/cancel)
  "function payOrderFor(address owner,address supplier,uint256 amount,bytes32 ref,bytes32 restaurantId) external",

  "function availableToWithdraw(address owner) view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",

  "function owed(address supplier) view returns (uint256)",
  "function totalOwed() view returns (uint256)",
] as const;
