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

    // Supplier claimable amounts
    mapping(address => uint256) public owed;
    uint256 public totalOwed;

    // Owner mode: if true, require explicit intent approval before execution
    mapping(address => bool) public requireApprovalForExecution;

    // Owner -> intent ref -> approved?
    mapping(address => mapping(bytes32 => bool)) public isIntentApproved;

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

    // New: immediate payment event
    event OrderPaid(
        address indexed owner,
        address indexed supplier,
        uint256 amount,
        bytes32 indexed ref,
        bytes32 restaurantId
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

    // Owner withdraws funds
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

    // NEW: Agent immediately pays for an order (no pending/cancel period).
    // Funds move from owner's hub balance into supplier claim pool (owed).
    function payOrderFor(
        address owner,
        address supplier,
        uint256 amount,
        bytes32 ref,
        bytes32 restaurantId
    ) external onlyAgentFor(owner) {
        require(owner != address(0), "owner=0");
        require(supplier != address(0), "supplier=0");
        require(amount > 0, "amount=0");
        require(balanceOf[owner] >= amount, "insufficient balance");

        // Manual mode: owner must approve the whole intent (ref) before execution
        if (requireApprovalForExecution[owner]) {
            require(ref != bytes32(0), "ref=0");
            require(isIntentApproved[owner][ref], "intent not approved");
        }

        // funds now belong to supplier claim pool
        balanceOf[owner] -= amount;

        owed[supplier] += amount;
        totalOwed += amount;

        emit OrderPaid(owner, supplier, amount, ref, restaurantId);
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
        return balanceOf[owner];
    }
}
