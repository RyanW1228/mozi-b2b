import { JsonRpcProvider, Wallet, Contract } from "ethers";

const TREASURY_HUB_ABI = [
  // --- agents / permissions ---
  "function setAgent(address agent, bool allowed) external",
  "function isAgentFor(address owner, address agent) view returns (bool)",

  // --- manual vs autonomous gating ---
  "function setRequireApprovalForExecution(bool required) external",
  "function requireApprovalForExecution(address owner) view returns (bool)",
  "function setIntentApproval(bytes32 ref, bool approved) external",
  "function isIntentApproved(address owner, bytes32 ref) view returns (bool)",

  // --- core order lifecycle ---
  "function nextOrderId() view returns (uint256)",
  "function pendingOrders(uint256) view returns (address owner,address supplier,uint256 amount,uint64 executeAfter,bool canceled,bool executed,bytes32 ref,bytes32 restaurantId)",
  "function proposeOrderFor(address owner,address supplier,uint256 amount,uint64 executeAfter,bytes32 ref,bytes32 restaurantId) returns (uint256)",
  "function executeOrder(uint256 orderId) external",
  "function cancelOrder(uint256 orderId) external",
] as const;

export type MoziEnv = "testing" | "production";

const SEPOLIA_NETWORK = { name: "sepolia", chainId: 11155111 } as const;

let cachedReadProvider: JsonRpcProvider | null = null;
let cachedReadHub: Contract | null = null;

let cachedWriteProvider: JsonRpcProvider | null = null;

function normalizeRpc(v?: string) {
  return (v ?? "").trim().replace(/^"|"$/g, "");
}

function getRpcUrl(env: MoziEnv) {
  if (env === "testing") {
    return (
      normalizeRpc(process.env.MOZI_SEPOLIA_RPC_URL) ||
      normalizeRpc(process.env.SEPOLIA_RPC_URL)
    );
  }
  return normalizeRpc(process.env.MOZI_MAINNET_RPC_URL);
}

export function getHubAddress() {
  const addr = process.env.NEXT_PUBLIC_MOZI_TREASURY_HUB_ADDRESS;
  if (!addr) throw new Error("Missing NEXT_PUBLIC_MOZI_TREASURY_HUB_ADDRESS");
  return addr;
}

export function getAgentWallet(env: MoziEnv) {
  const pk = process.env.MOZI_AGENT_PRIVATE_KEY;
  if (!pk) throw new Error("Missing MOZI_AGENT_PRIVATE_KEY");

  const rpc = getRpcUrl(env);
  if (!rpc) {
    throw new Error(
      env === "testing"
        ? "Missing MOZI_SEPOLIA_RPC_URL / SEPOLIA_RPC_URL"
        : "Missing MOZI_MAINNET_RPC_URL"
    );
  }

  if (env === "testing") {
    if (!cachedWriteProvider) {
      cachedWriteProvider = new JsonRpcProvider(rpc, SEPOLIA_NETWORK);
    }
    return new Wallet(pk, cachedWriteProvider);
  }

  const provider = new JsonRpcProvider(rpc);
  return new Wallet(pk, provider);
}

export function getHubRead(env: MoziEnv) {
  const rpc = getRpcUrl(env);
  if (!rpc) {
    throw new Error(
      env === "testing"
        ? "Missing MOZI_SEPOLIA_RPC_URL / SEPOLIA_RPC_URL"
        : "Missing MOZI_MAINNET_RPC_URL"
    );
  }

  if (env === "testing") {
    if (!cachedReadProvider) {
      cachedReadProvider = new JsonRpcProvider(rpc, SEPOLIA_NETWORK);
    }
    if (!cachedReadHub) {
      cachedReadHub = new Contract(
        getHubAddress(),
        TREASURY_HUB_ABI,
        cachedReadProvider
      );
    }
    return cachedReadHub;
  }

  const provider = new JsonRpcProvider(rpc);
  return new Contract(getHubAddress(), TREASURY_HUB_ABI, provider);
}

export function getHubWrite(env: MoziEnv) {
  const agent = getAgentWallet(env);
  return new Contract(getHubAddress(), TREASURY_HUB_ABI, agent);
}
