// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "openzeppelin-contracts/contracts/access/Ownable.sol";
import "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";

contract MoziTreasury is Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;

    // ---- Roles ----
    address public agent; // Mozi backend/AI allowed to propose/execute orders

    modifier onlyAgent() {
        require(msg.sender == agent, "not agent");
        _;
    }

    // ---- Supplier balances (claimable, executed orders) ----
    mapping(address => uint256) public owed;
    uint256 public totalOwed;

    // ---- Pending orders (reserved, not claimable yet) ----
    struct PendingOrder {
        address supplier;
        uint256 amount;
        uint64 executeAfter; // unix seconds
        bool canceled;
        bool executed;
        bytes32 ref; // idempotency/audit (optional)
        bytes32 restaurantId; // optional metadata (owner has multiple restaurants)
    }

    uint256 public nextOrderId;
    mapping(uint256 => PendingOrder) public pendingOrders;
    uint256 public totalReserved; // sum of amounts of non-canceled, non-executed pending orders

    // ---- Events ----
    event AgentSet(address indexed agent);
    event Deposited(address indexed from, uint256 amount);

    event OrderProposed(
        uint256 indexed orderId,
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
    event Withdrawn(address indexed owner, uint256 amount);

    constructor(
        address tokenAddress,
        address owner_,
        address agent_
    ) Ownable(owner_) {
        require(tokenAddress != address(0), "token=0");
        token = IERC20(tokenAddress);
        agent = agent_;
        emit AgentSet(agent_);
    }

    function setAgent(address agent_) external onlyOwner {
        agent = agent_;
        emit AgentSet(agent_);
    }

    // Owner funds treasury: user must approve first
    function deposit(uint256 amount) external {
        require(amount > 0, "amount=0");
        token.safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(msg.sender, amount);
    }

    // ---- Pending order flow ----

    /// Agent proposes an order that becomes executable after a delay.
    /// Funds become RESERVED immediately (owner can't withdraw them),
    /// but supplier can't claim until executed.
    function proposeOrder(
        address supplier,
        uint256 amount,
        uint64 executeAfter,
        bytes32 ref,
        bytes32 restaurantId
    ) external onlyAgent returns (uint256 orderId) {
        require(supplier != address(0), "supplier=0");
        require(amount > 0, "amount=0");
        require(executeAfter > block.timestamp, "executeAfter must be future");

        // Must have enough free funds to reserve
        require(amount <= availableToReserve(), "insufficient available");

        orderId = nextOrderId++;
        pendingOrders[orderId] = PendingOrder({
            supplier: supplier,
            amount: amount,
            executeAfter: executeAfter,
            canceled: false,
            executed: false,
            ref: ref,
            restaurantId: restaurantId
        });

        totalReserved += amount;

        emit OrderProposed(
            orderId,
            supplier,
            amount,
            executeAfter,
            ref,
            restaurantId
        );
    }

    /// Owner can cancel during the pending window (or anytime before execution).
    /// This releases the reservation.
    function cancelOrder(uint256 orderId) external onlyOwner {
        PendingOrder storage o = pendingOrders[orderId];
        require(!o.canceled, "already canceled");
        require(!o.executed, "already executed");

        o.canceled = true;
        totalReserved -= o.amount;

        emit OrderCanceled(orderId);
    }

    /// After executeAfter passes, the agent executes:
    /// reservation moves from "reserved" to "owed" (claimable).
    function executeOrder(uint256 orderId) external onlyAgent {
        PendingOrder storage o = pendingOrders[orderId];
        require(!o.canceled, "canceled");
        require(!o.executed, "executed");
        require(block.timestamp >= o.executeAfter, "too early");

        o.executed = true;
        totalReserved -= o.amount;

        owed[o.supplier] += o.amount;
        totalOwed += o.amount;

        emit OrderExecuted(orderId, o.supplier, o.amount);
    }

    // ---- Supplier claim ----
    function claim() external {
        uint256 amt = owed[msg.sender];
        require(amt > 0, "nothing owed");

        owed[msg.sender] = 0;
        totalOwed -= amt;

        token.safeTransfer(msg.sender, amt);
        emit Claimed(msg.sender, amt);
    }

    // ---- Owner withdraw ----
    // Owner can withdraw only what is NOT reserved and NOT owed.
    function availableToWithdraw() public view returns (uint256) {
        uint256 bal = token.balanceOf(address(this));
        uint256 locked = totalReserved + totalOwed;
        if (bal <= locked) return 0;
        return bal - locked;
    }

    function withdrawAvailable() external onlyOwner {
        uint256 amt = availableToWithdraw();
        require(amt > 0, "nothing available");
        token.safeTransfer(owner(), amt);
        emit Withdrawn(owner(), amt);
    }

    function withdraw(uint256 amount) external onlyOwner {
        require(amount > 0, "amount=0");
        require(amount <= availableToWithdraw(), "amount > available");
        token.safeTransfer(owner(), amount);
        emit Withdrawn(owner(), amount);
    }

    // ---- Helpers ----
    // How much more we can reserve into pending orders
    function availableToReserve() public view returns (uint256) {
        // same as withdrawable: only free funds can be reserved
        return availableToWithdraw();
    }
}
