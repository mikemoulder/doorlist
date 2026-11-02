// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @dev The subset of ERC-20 we use. On Portaldot, native `pallet_assets` tokens expose it
/// through a precompile at 0x{assetId:8 hex}000000000000000000000000{00010000}.
interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @title Doorlist: event tickets that can't be faked or copied, with refunds enforced by code.
/// @notice Each ticket stores a "ticket key": an address whose private key lives only on
/// the holder's phone. The phone signs a fresh (ticketId, timestamp) every few seconds for
/// its QR code; the door app checks that signature against `tickets[id].key` off-chain,
/// then calls `checkIn`. A screenshot expires, a copied QR fails the key check, and a
/// second check-in reverts.
///
/// Money:
/// - First sales are held in escrow by this contract. From `startsAt + 24h` the organizer
///   withdraws them, minus a 3% platform fee to `treasury`.
/// - Until then the organizer may cancel. A cancelled event can never be withdrawn; every
///   ticket holder claims a full face-price refund directly from escrow. No organizer needed.
/// - Resales at any price settle instantly: 3% fee, a per-event organizer royalty (0 to 10%),
///   the rest to the seller. The buyer's key replaces the seller's in the same transaction.
contract Doorlist {
    uint256 public constant PLATFORM_FEE_BPS = 300; // 3%
    uint256 public constant MAX_ROYALTY_BPS = 1000; // 10%
    uint256 public constant PAYOUT_DELAY = 1 days; // after startsAt; also the end of the cancel window

    address public immutable treasury;

    struct Event {
        address organizer;
        uint64 startsAt;
        uint32 capacity;
        uint32 sold;
        uint32 maxPerWallet; // 0 = no limit
        uint16 royaltyBps; // organizer's cut of every resale
        bool cancelled; // no sales, resales or check-ins; holders can claim refunds
        uint128 price; // face price, in the smallest unit of `currency`
        uint128 escrowed; // first-sale money held for this event
        address currency; // address(0) = native tPOT, else an ERC-20 (e.g. a native asset precompile)
        string name;
    }

    struct Ticket {
        uint64 eventId;
        bool used; // checked in
        bool refunded;
        address owner;
        address key;
        uint128 askPrice; // 0 = not for resale
    }

    Event[] public events;
    Ticket[] public tickets;
    mapping(uint256 eventId => mapping(address door => bool)) public isDoor;
    mapping(uint256 eventId => mapping(address holder => uint256)) public held;

    event EventCreated(uint256 indexed eventId, address indexed organizer, string name);
    event DoorSet(uint256 indexed eventId, address indexed door, bool allowed);
    event TicketBought(uint256 indexed ticketId, uint256 indexed eventId, address indexed owner, address key);
    event Listed(uint256 indexed ticketId, uint128 price);
    event Resold(uint256 indexed ticketId, address indexed from, address indexed to, uint128 price);
    event KeyRotated(uint256 indexed ticketId, address key);
    event CheckedIn(uint256 indexed ticketId, uint256 indexed eventId, address door);
    event EventCancelled(uint256 indexed eventId);
    event Refunded(uint256 indexed ticketId, address indexed holder, uint128 amount);
    event Withdrawn(uint256 indexed eventId, uint256 toOrganizer, uint256 fee);

    error NotOrganizer();
    error NotOwner();
    error NotDoor();
    error SoldOut();
    error WalletLimit();
    error RoyaltyTooHigh();
    error WrongPayment();
    error AlreadyUsed();
    error NotListed();
    error PayoutFailed();
    error Cancelled();
    error NotCancelled();
    error TooEarly();
    error TooLate();

    constructor(address treasury_) {
        treasury = treasury_;
    }

    function createEvent(
        string calldata name,
        uint64 startsAt,
        uint32 capacity,
        uint128 price,
        address currency,
        uint32 maxPerWallet,
        uint16 royaltyBps
    ) external returns (uint256 eventId) {
        if (royaltyBps > MAX_ROYALTY_BPS) revert RoyaltyTooHigh();
        eventId = events.length;
        events.push(Event(msg.sender, startsAt, capacity, 0, maxPerWallet, royaltyBps, false, price, 0, currency, name));
        emit EventCreated(eventId, msg.sender, name);
    }

    function setDoor(uint256 eventId, address door, bool allowed) external {
        if (events[eventId].organizer != msg.sender) revert NotOrganizer();
        isDoor[eventId][door] = allowed;
        emit DoorSet(eventId, door, allowed);
    }

    /// @notice Buy at face price. The money stays in escrow until the organizer can withdraw.
    function buy(uint256 eventId, address key) external payable returns (uint256 ticketId) {
        Event storage e = events[eventId];
        if (e.cancelled) revert Cancelled();
        if (e.sold >= e.capacity) revert SoldOut();
        e.sold++;
        e.escrowed += e.price;
        _hold(eventId, e.maxPerWallet);
        ticketId = tickets.length;
        tickets.push(Ticket(uint64(eventId), false, false, msg.sender, key, 0));
        emit TicketBought(ticketId, eventId, msg.sender, key);
        _checkValue(e.currency, e.price);
        _send(e.currency, msg.sender, address(this), e.price);
    }

    /// @notice List a ticket for resale at any price. A price of 0 takes it off the market.
    function list(uint256 ticketId, uint128 price) external {
        Ticket storage t = tickets[ticketId];
        if (t.owner != msg.sender) revert NotOwner();
        if (t.used || t.refunded) revert AlreadyUsed();
        t.askPrice = price;
        emit Listed(ticketId, price);
    }

    function buyResale(uint256 ticketId, address newKey) external payable {
        Ticket storage t = tickets[ticketId];
        uint128 price = t.askPrice;
        if (price == 0 || t.used || t.refunded) revert NotListed();
        Event storage e = events[t.eventId];
        if (e.cancelled) revert Cancelled();
        address seller = t.owner;
        held[t.eventId][seller]--;
        _hold(t.eventId, e.maxPerWallet);
        t.owner = msg.sender;
        t.key = newKey; // the seller's phone key stops working immediately
        t.askPrice = 0;
        emit Resold(ticketId, seller, msg.sender, price);
        _checkValue(e.currency, price);
        uint256 fee = price * PLATFORM_FEE_BPS / 10_000;
        uint256 royalty = price * e.royaltyBps / 10_000;
        _send(e.currency, msg.sender, treasury, fee);
        _send(e.currency, msg.sender, e.organizer, royalty);
        _send(e.currency, msg.sender, seller, price - fee - royalty);
    }

    /// @notice New phone? Point the ticket at a new key; the old QR codes die.
    function rotateKey(uint256 ticketId, address newKey) external {
        Ticket storage t = tickets[ticketId];
        if (t.owner != msg.sender) revert NotOwner();
        t.key = newKey;
        emit KeyRotated(ticketId, newKey);
    }

    function checkIn(uint256 ticketId) external {
        Ticket storage t = tickets[ticketId];
        if (!isDoor[t.eventId][msg.sender]) revert NotDoor();
        if (events[t.eventId].cancelled) revert Cancelled();
        if (t.used) revert AlreadyUsed();
        t.used = true;
        t.askPrice = 0;
        emit CheckedIn(ticketId, t.eventId, msg.sender);
    }

    /// @notice Cancel before the payout window opens. Sales, resales and check-ins stop, the
    /// organizer can never withdraw, and every holder can claim a full refund.
    function cancelEvent(uint256 eventId) external {
        Event storage e = events[eventId];
        if (e.organizer != msg.sender) revert NotOrganizer();
        if (block.timestamp >= e.startsAt + PAYOUT_DELAY) revert TooLate();
        e.cancelled = true;
        emit EventCancelled(eventId);
    }

    /// @notice Holder of a ticket for a cancelled event takes back the face price from escrow.
    function claimRefund(uint256 ticketId) external {
        Ticket storage t = tickets[ticketId];
        Event storage e = events[t.eventId];
        if (!e.cancelled) revert NotCancelled();
        if (t.owner != msg.sender) revert NotOwner();
        if (t.refunded) revert AlreadyUsed();
        t.refunded = true;
        t.askPrice = 0;
        e.escrowed -= e.price;
        emit Refunded(ticketId, msg.sender, e.price);
        _send(e.currency, address(this), msg.sender, e.price);
    }

    /// @notice From startsAt + 24h, pay the organizer everything in escrow, minus the 3% fee.
    /// Callable again for any later sales.
    function withdraw(uint256 eventId) external {
        Event storage e = events[eventId];
        if (e.organizer != msg.sender) revert NotOrganizer();
        if (e.cancelled) revert Cancelled();
        if (block.timestamp < e.startsAt + PAYOUT_DELAY) revert TooEarly();
        uint256 amount = e.escrowed;
        e.escrowed = 0;
        uint256 fee = amount * PLATFORM_FEE_BPS / 10_000;
        emit Withdrawn(eventId, amount - fee, fee);
        _send(e.currency, address(this), treasury, fee);
        _send(e.currency, address(this), msg.sender, amount - fee);
    }

    function _hold(uint256 eventId, uint32 maxPerWallet) private {
        uint256 n = ++held[eventId][msg.sender];
        if (maxPerWallet != 0 && n > maxPerWallet) revert WalletLimit();
    }

    function _checkValue(address currency, uint256 amount) private view {
        if (currency == address(0) ? msg.value != amount : msg.value != 0) revert WrongPayment();
    }

    /// @dev Native tPOT always moves out of this contract's balance (msg.value has already
    /// arrived). ERC-20s move from `from`: the buyer via allowance, or this contract.
    function _send(address currency, address from, address to, uint256 amount) private {
        if (amount == 0 || to == address(this) && currency == address(0)) return;
        bool ok;
        if (currency == address(0)) (ok,) = to.call{value: amount}("");
        else if (from == address(this)) ok = IERC20(currency).transfer(to, amount);
        else ok = IERC20(currency).transferFrom(from, to, amount);
        if (!ok) revert PayoutFailed();
    }
}
