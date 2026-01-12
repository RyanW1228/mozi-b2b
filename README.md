# Mozi

**Autonomous, on-chain operations for real-world purchasing**

Mozi is a hackathon project that explores how AI agents can plan and execute real-world purchase orders directly on-chain. Given a restaurant/location's inventory state, preferences, and constraints (budget, waste tolerance, planning horizon, etc.), Mozi generates an order plan and immediately executes payments through a smart contract—optionally with or without human approval.

This repository contains the full stack:

- A Next.js dashboard for configuration and monitoring
- Server routes for planning and execution
- An Ethereum smart contract (Treasury Hub) that enforces approval modes and performs payments

---

## ✨ Key Features

- **AI-driven order planning** – Converts inventory state + business constraints into a concrete purchasing plan.
- **Autonomous or Manual execution** – Toggle between:

  - **Autonomous:** AI plans and immediately executes on-chain.
  - **Manual:** AI plans first, user approves before execution.

- **On-chain payments** – Orders are executed as smart contract calls, providing transparency and auditability.
- **Pipeline-aware inventory** – Tracks inbound orders so future plans account for what’s already been ordered.
- **Stateless-friendly MVP design** – In-memory stores and idempotent routes for fast hackathon iteration.

---

## 🧱 Architecture

```
UI (Next.js)
   |
   v
/api/state   -> builds current inventory + pipeline context
/api/plan    -> AI model generates a purchase plan
/api/execute -> encodes + broadcasts on-chain calls
   |
   v
MoziTreasuryHub (Smart Contract)
   - Enforces approval mode
   - Executes supplier payments
```

**Flow:**

1. User (or AI in autonomous mode) requests order generation.
2. Backend builds the current state (`/api/state`).
3. AI generates a plan (`/api/plan`).
4. Plan is converted into on-chain calls and broadcast (`/api/execute`).
5. Executed intents are persisted in an in-memory store for UI and future planning.

---

## ⚙️ Tech Stack

- **Frontend:** Next.js (App Router), React
- **Backend:** Next.js API routes (Node runtime)
- **Blockchain:** Ethereum (tested on Sepolia)
- **Smart Contracts:** Solidity (MoziTreasuryHub)
- **Wallet / RPC:** ethers.js
- **AI:** Google Gemini (via `@google/genai`)
- **Hosting:** Vercel

---

## 🚀 Getting Started

### 1. Clone

```bash
git clone <your-repo-url>
cd mozi
```

### 2. Install

```bash
npm install
```

### 3. Environment Variables

Create a `.env.local` file with:

```env
# RPC + Wallet
SEPOLIA_RPC_URL=...
MOZI_AGENT_PRIVATE_KEY=...

# Deployed contract
NEXT_PUBLIC_MOZI_TREASURY_HUB_ADDRESS=0x...

# AI
GOOGLE_API_KEY=...
```

### 4. Run Locally

```bash
npm run dev
```

Visit: `http://localhost:3000`

---

## 🔐 Smart Contract

The **MoziTreasuryHub** contract is responsible for:

- Holding funds
- Enforcing whether execution requires human approval
- Paying suppliers on behalf of restaurant owners

Key concept:

- `requireApprovalForExecution`: when `false`, the system is fully autonomous.

> Example deployment (Sepolia):
> `0x243B3Bc9f26b7667C33Ba4E68Ade010B91CEC2bc`

---

## 🧪 Example Flow (Autonomous Mode)

1. Open a location dashboard.
2. Click **Generate Orders**.
3. The AI:

   - Reads inventory + constraints
   - Decides what to buy and from whom

4. Orders are **immediately executed on-chain**.
5. UI updates with executed order details.

---

## 📂 Project Structure

```
src/
  app/
    locations/[locationId]/page.tsx   # Main dashboard
    api/
      state/                          # Build planning context
      plan/                           # AI planning
      orders/
        propose/                      # Orchestrates plan + execution
        execute/                      # Broadcasts on-chain calls
  lib/
    stateStore.ts                     # In-memory restaurant state
    intentStore.ts                    # Executed order tracking
    abis/                             # Contract ABIs
```

---

## ⚠️ Limitations

- **In-memory storage**: Resets on redeploy/restart (MVP only).
- **Determinism**: AI plans can vary for the same input.
- **Testnet only**: Not production-hardened.

---

## 🔮 What’s Next

- Persistent database for state and order history
- Deterministic planning or verifiable reasoning
- Consumer-facing version for automated personal shopping
- Broader supplier integrations and pricing oracles

---

## 📄 License

MIT
