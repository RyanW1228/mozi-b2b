// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";

contract MoziTreasuryHub {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;

    // Owner -> deposited balance tracked inside hub
    mapping(address => uint256) public balanceOf;

    // Owner -> agent authorization
    mapping(address => mapping(address => bool)) public isAgentFor;

    // Supplier claimable (executed) amounts
    mapping(address => uint256) public owed;
    uint256 public totalOwed;

    // Owner -> total reserved in pending orders (not withdrawable)
    mapping(address => uint256) public reservedOf;

    // Owner mode: if true, require explicit intent approval before execution
    mapping(address => bool) public requireApprovalForExecution;

    // Owner -> intent ref -> approved?
    mapping(address => mapping(bytes32 => bool)) public isIntentApproved;

    struct PendingOrder {
        address owner; // whose treasury this draws from
        address supplier;
        uint256 amount;
        uint64 executeAfter; // unix seconds, chosen per-order (NOT hardcoded)
        bool canceled;
        bool executed;
        bytes32 ref; // idempotency/audit id (optional)
        bytes32 restaurantId; // optional metadata
    }

    uint256 public nextOrderId;
    mapping(uint256 => PendingOrder) public pendingOrders;

    event Deposited(
        address indexed owner,
        address indexed from,
        uint256 amount
    );
    event Withdrawn(address indexed owner, address indexed to, uint256 amount);

    event AgentSet(address indexed owner, address indexed agent, bool allowed);

    event RequireApprovalSet(address indexed owner, bool required);
    event IntentApprovalSet(
        address indexed owner,
        bytes32 indexed ref,
        bool approved
    );

    event OrderProposed(
        uint256 indexed orderId,
        address indexed owner,
        address indexed supplier,
        uint256 amount,
        uint64 executeAfter,
        bytes32 ref,
        bytes32 restaurantId
    );
    event OrderCanceled(uint256 indexed orderId);
    event OrderExecuted(
        uint256 indexed orderId,
        address indexed supplier,
        uint256 amount
    );

    event Claimed(address indexed supplier, uint256 amount);

    constructor(address tokenAddress) {
        require(tokenAddress != address(0), "token=0");
        token = IERC20(tokenAddress);
    }

    // -------------------------
    // Owner actions
    // -------------------------

    // Owner deposits token into hub under THEIR balance
    function deposit(uint256 amount) external {
        require(amount > 0, "amount=0");
        token.safeTransferFrom(msg.sender, address(this), amount);
        balanceOf[msg.sender] += amount;
        emit Deposited(msg.sender, msg.sender, amount);
    }

    // Owner withdraws unreserved funds
    function withdraw(uint256 amount) external {
        require(amount > 0, "amount=0");
        require(
            amount <= availableToWithdraw(msg.sender),
            "amount > available"
        );
        balanceOf[msg.sender] -= amount;
        token.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, msg.sender, amount);
    }

    function withdrawAvailable() external {
        uint256 amt = availableToWithdraw(msg.sender);
        require(amt > 0, "nothing available");
        balanceOf[msg.sender] -= amt;
        token.safeTransfer(msg.sender, amt);
        emit Withdrawn(msg.sender, msg.sender, amt);
    }

    // Owner authorizes a backend agent (Mozi)
    function setAgent(address agent, bool allowed) external {
        require(agent != address(0), "agent=0");
        isAgentFor[msg.sender][agent] = allowed;
        emit AgentSet(msg.sender, agent, allowed);
    }

    // Owner sets whether execution requires explicit approval (Manual vs Autonomous)
    function setRequireApprovalForExecution(bool required) external {
        requireApprovalForExecution[msg.sender] = required;
        emit RequireApprovalSet(msg.sender, required);
    }

    // Owner approves (or un-approves) an entire intent by ref
    function setIntentApproval(bytes32 ref, bool approved) external {
        require(ref != bytes32(0), "ref=0");
        isIntentApproved[msg.sender][ref] = approved;
        emit IntentApprovalSet(msg.sender, ref, approved);
    }

    // -------------------------
    // Agent actions (for an owner)
    // -------------------------

    modifier onlyAgentFor(address owner) {
        require(isAgentFor[owner][msg.sender], "not agent");
        _;
    }

    // Reserve funds immediately (so owner can't withdraw them),
    // but supplier can't claim until executed after executeAfter.
    function proposeOrderFor(
        address owner,
        address supplier,
        uint256 amount,
        uint64 executeAfter,
        bytes32 ref,
        bytes32 restaurantId
    ) external onlyAgentFor(owner) returns (uint256 orderId) {
        require(owner != address(0), "owner=0");
        require(supplier != address(0), "supplier=0");
        require(amount > 0, "amount=0");
        require(executeAfter > block.timestamp, "executeAfter must be future");

        // Owner must have enough free funds to reserve
        require(amount <= availableToWithdraw(owner), "insufficient available");

        // Reserve immediately
        reservedOf[owner] += amount;

        orderId = nextOrderId++;
        pendingOrders[orderId] = PendingOrder({
            owner: owner,
            supplier: supplier,
            amount: amount,
            executeAfter: executeAfter,
            canceled: false,
            executed: false,
            ref: ref,
            restaurantId: restaurantId
        });

        emit OrderProposed(
            orderId,
            owner,
            supplier,
            amount,
            executeAfter,
            ref,
            restaurantId
        );
    }

    // Owner can cancel pending orders anytime before execution
    function cancelOrder(uint256 orderId) external {
        PendingOrder storage o = pendingOrders[orderId];
        require(o.owner == msg.sender, "not order owner");
        require(!o.canceled, "already canceled");
        require(!o.executed, "already executed");

        o.canceled = true;
        reservedOf[o.owner] -= o.amount;

        emit OrderCanceled(orderId);
    }

    // Agent executes after executeAfter: move from reserved -> supplier owed
    function executeOrder(uint256 orderId) external {
        PendingOrder storage o = pendingOrders[orderId];
        require(o.owner != address(0), "bad order");
        require(isAgentFor[o.owner][msg.sender], "not agent");
        require(!o.canceled, "canceled");
        require(!o.executed, "executed");
        require(block.timestamp >= o.executeAfter, "too early");

        // Manual mode: owner must approve the whole intent (ref) before execution
        if (requireApprovalForExecution[o.owner]) {
            require(isIntentApproved[o.owner][o.ref], "intent not approved");
        }

        o.executed = true;

        reservedOf[o.owner] -= o.amount;

        // Decrease owner's internal balance (funds now belong to supplier claim pool)
        balanceOf[o.owner] -= o.amount;

        owed[o.supplier] += o.amount;
        totalOwed += o.amount;

        emit OrderExecuted(orderId, o.supplier, o.amount);
    }

    // -------------------------
    // Supplier action
    // -------------------------

    function claim() external {
        uint256 amt = owed[msg.sender];
        require(amt > 0, "nothing owed");

        owed[msg.sender] = 0;
        totalOwed -= amt;

        token.safeTransfer(msg.sender, amt);
        emit Claimed(msg.sender, amt);
    }

    // -------------------------
    // Views
    // -------------------------

    function availableToWithdraw(address owner) public view returns (uint256) {
        uint256 bal = balanceOf[owner];
        uint256 res = reservedOf[owner];
        if (bal <= res) return 0;
        return bal - res;
    }
}
