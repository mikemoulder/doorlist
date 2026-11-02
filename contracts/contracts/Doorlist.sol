// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @dev The subset of ERC-20 we use. On Portaldot, native `pallet_assets` tokens expose it
/// through a precompile at 0x{assetId:8 hex}000000000000000000000000{00010000}.
interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @title Doorlist: event tickets that can't be faked or copied.
/// @notice Each ticket stores a "ticket key": an address whose private key lives only on
/// the holder's phone. The phone signs a fresh (ticketId, timestamp) every few seconds for
/// its QR code; the door app checks that signature against `tickets[id].key` off-chain,
/// then calls `checkIn`. A screenshot expires, a copied QR fails the key check, and a
/// second check-in reverts.
///
/// Economics: every sale pays a 3% platform fee to `treasury`. Resales also pay the
/// organizer a royalty they choose per event (0 to 10%). Organizers cap how many tickets
/// one wallet may hold per event. Funds move buyer -> recipients in the same transaction;
/// the contract never holds a balance.
contract Doorlist {
    uint256 public constant PLATFORM_FEE_BPS = 300; // 3%
    uint256 public constant MAX_ROYALTY_BPS = 1000; // 10%

    address public immutable treasury;

    struct Event {
        address organizer;
        uint64 startsAt;
        uint32 capacity;
        uint32 sold;
        uint32 maxPerWallet; // 0 = no limit
        uint16 royaltyBps; // organizer's cut of every resale
        bool cancelled; // no sales, resales or check-ins once set
        uint128 price; // in the smallest unit of `currency`
        address currency; // address(0) = native tPOT, else an ERC-20 (e.g. a native asset precompile)
        string name;
    }

    struct Ticket {
        uint64 eventId;
        bool used;
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
        events.push(Event(msg.sender, startsAt, capacity, 0, maxPerWallet, royaltyBps, false, price, currency, name));
        emit EventCreated(eventId, msg.sender, name);
    }

    function setDoor(uint256 eventId, address door, bool allowed) external {
        if (events[eventId].organizer != msg.sender) revert NotOrganizer();
        isDoor[eventId][door] = allowed;
        emit DoorSet(eventId, door, allowed);
    }

    function buy(uint256 eventId, address key) external payable returns (uint256 ticketId) {
        Event storage e = events[eventId];
        if (e.cancelled) revert Cancelled();
        if (e.sold >= e.capacity) revert SoldOut();
        e.sold++;
        _hold(eventId, e.maxPerWallet);
        ticketId = tickets.length;
        tickets.push(Ticket(uint64(eventId), false, msg.sender, key, 0));
        emit TicketBought(ticketId, eventId, msg.sender, key);
        _settle(e.currency, e.price, e.organizer, address(0), 0);
    }

    /// @notice List a ticket for resale at any price. A price of 0 takes it off the market.
    function list(uint256 ticketId, uint128 price) external {
        Ticket storage t = tickets[ticketId];
        if (t.owner != msg.sender) revert NotOwner();
        if (t.used) revert AlreadyUsed();
        t.askPrice = price;
        emit Listed(ticketId, price);
    }

    function buyResale(uint256 ticketId, address newKey) external payable {
        Ticket storage t = tickets[ticketId];
        uint128 price = t.askPrice;
        if (price == 0 || t.used) revert NotListed();
        Event storage e = events[t.eventId];
        if (e.cancelled) revert Cancelled();
        address seller = t.owner;
        held[t.eventId][seller]--;
        _hold(t.eventId, e.maxPerWallet);
        t.owner = msg.sender;
        t.key = newKey; // the seller's phone key stops working immediately
        t.askPrice = 0;
        emit Resold(ticketId, seller, msg.sender, price);
        _settle(e.currency, price, seller, e.organizer, e.royaltyBps);
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

    /// @notice Stop all sales, resales and check-ins. On-chain data can't be deleted; the
    /// event is marked cancelled for everyone to see.
    function cancelEvent(uint256 eventId) external {
        Event storage e = events[eventId];
        if (e.organizer != msg.sender) revert NotOrganizer();
        e.cancelled = true;
        emit EventCancelled(eventId);
    }

    /// @notice The organizer pays the current holder back the face price and voids the ticket.
    /// The 3% platform fee is not returned. Works before or after `cancelEvent`.
    function refund(uint256 ticketId) external payable {
        Ticket storage t = tickets[ticketId];
        Event storage e = events[t.eventId];
        if (e.organizer != msg.sender) revert NotOrganizer();
        if (t.used) revert AlreadyUsed();
        t.used = true; // void: can't be checked in, listed or resold
        t.askPrice = 0;
        held[t.eventId][t.owner]--;
        emit Refunded(ticketId, t.owner, e.price);
        if (e.currency == address(0) ? msg.value != e.price : msg.value != 0) revert WrongPayment();
        _send(e.currency, t.owner, e.price);
    }

    function eventCount() external view returns (uint256) {
        return events.length;
    }

    function ticketCount() external view returns (uint256) {
        return tickets.length;
    }

    function _hold(uint256 eventId, uint32 maxPerWallet) private {
        uint256 n = ++held[eventId][msg.sender];
        if (maxPerWallet != 0 && n > maxPerWallet) revert WalletLimit();
    }

    /// @dev Splits `amount` paid by msg.sender: 3% to treasury, `royaltyBps` to `royaltyTo`,
    /// the rest to `payee`. Every transfer goes straight from the buyer.
    function _settle(address currency, uint256 amount, address payee, address royaltyTo, uint256 royaltyBps)
        private
    {
        if (currency == address(0) ? msg.value != amount : msg.value != 0) revert WrongPayment();
        uint256 fee = amount * PLATFORM_FEE_BPS / 10_000;
        uint256 royalty = amount * royaltyBps / 10_000;
        _send(currency, treasury, fee);
        _send(currency, royaltyTo, royalty);
        _send(currency, payee, amount - fee - royalty);
    }

    function _send(address currency, address to, uint256 amount) private {
        if (amount == 0) return;
        bool ok;
        if (currency == address(0)) (ok,) = to.call{value: amount}("");
        else ok = IERC20(currency).transferFrom(msg.sender, to, amount);
        if (!ok) revert PayoutFailed();
    }
}
