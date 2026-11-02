// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @dev The subset of ERC-20 we use. On Portaldot, native `pallet_assets` tokens expose it
/// through a precompile at 0x{assetId:8 hex}000000000000000000000000{00010000}.
interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @title Doorlist: wallet-bound event tickets that can't be faked or copied, with refunds
/// enforced by code.
/// @notice A ticket is a token owned by a wallet. It only moves through Doorlist: every
/// resale or gift burns the old token and mints a new one to the new owner, so any QR code
/// made for the old token id dies with it. Tokens emit ERC-721 `Transfer` events.
///
/// At the door: the owner's wallet signs a pass for their phone once; the phone then shows
/// a QR refreshed every few seconds. The door app checks that the pass was signed by
/// `ownerOf(ticketId)` and that the QR is fresh, then calls `checkIn`, which works once.
///
/// Money:
/// - First sales are held in escrow by this contract. From `startsAt + 24h` the organizer
///   withdraws them, minus a 3% platform fee to `treasury`.
/// - Until then the organizer may cancel. A cancelled event can never be withdrawn by the
///   organizer; every holder claims a full face-price refund from escrow, no organizer needed.
/// - Resales at any price settle instantly: 3% fee, a per-event organizer royalty (0 to 10%),
///   the rest to the seller. Gifts are free.
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
        bool cancelled; // no sales, transfers or check-ins; holders can claim refunds
        uint128 price; // face price, in the smallest unit of `currency`
        uint128 escrowed; // first-sale money held for this event
        address currency; // address(0) = native tPOT, else an ERC-20 (e.g. a native asset precompile)
        string name;
    }

    struct Ticket {
        uint64 eventId;
        bool used; // checked in
        bool refunded;
        address owner; // address(0) = burned
        uint128 askPrice; // 0 = not for resale
    }

    Event[] public events;
    Ticket[] public tickets;
    mapping(uint256 eventId => mapping(address door => bool)) public isDoor;
    mapping(uint256 eventId => mapping(address holder => uint256)) public held;

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId); // ERC-721 shape
    event EventCreated(uint256 indexed eventId, address indexed organizer, string name);
    event DoorSet(uint256 indexed eventId, address indexed door, bool allowed);
    event Listed(uint256 indexed ticketId, uint128 price);
    event Reminted(uint256 indexed oldId, uint256 indexed newId, uint128 price); // price 0 = gift
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
    function buy(uint256 eventId) external payable returns (uint256 ticketId) {
        Event storage e = events[eventId];
        if (e.cancelled) revert Cancelled();
        if (e.sold >= e.capacity) revert SoldOut();
        e.sold++;
        e.escrowed += e.price;
        ticketId = _mint(eventId, msg.sender);
        _checkValue(e.currency, e.price);
        _send(e.currency, msg.sender, address(this), e.price);
    }

    /// @notice List a ticket for resale at any price. A price of 0 takes it off the market.
    function list(uint256 ticketId, uint128 price) external {
        Ticket storage t = _live(ticketId);
        if (t.owner != msg.sender) revert NotOwner();
        t.askPrice = price;
        emit Listed(ticketId, price);
    }

    /// @notice Buy a listed ticket. The old token is burned and a new one minted to the buyer.
    function buyResale(uint256 ticketId) external payable returns (uint256 newId) {
        Ticket storage t = _live(ticketId);
        uint128 price = t.askPrice;
        if (price == 0) revert NotListed();
        Event storage e = events[t.eventId];
        address seller = t.owner;
        newId = _remint(ticketId, msg.sender, price);
        _checkValue(e.currency, price);
        uint256 fee = price * PLATFORM_FEE_BPS / 10_000;
        uint256 royalty = price * e.royaltyBps / 10_000;
        _send(e.currency, msg.sender, treasury, fee);
        _send(e.currency, msg.sender, e.organizer, royalty);
        _send(e.currency, msg.sender, seller, price - fee - royalty);
    }

    /// @notice Give a ticket to another wallet, free. Burned and re-minted to `to`.
    function transfer(uint256 ticketId, address to) external returns (uint256 newId) {
        if (_live(ticketId).owner != msg.sender) revert NotOwner();
        newId = _remint(ticketId, to, 0);
    }

    function checkIn(uint256 ticketId) external {
        Ticket storage t = _live(ticketId);
        if (!isDoor[t.eventId][msg.sender]) revert NotDoor();
        t.used = true;
        t.askPrice = 0;
        emit CheckedIn(ticketId, t.eventId, msg.sender);
    }

    /// @notice Cancel before the payout window opens. Sales, transfers and check-ins stop, the
    /// organizer can never withdraw, and every holder can claim a full refund.
    function cancelEvent(uint256 eventId) external {
        Event storage e = events[eventId];
        if (e.organizer != msg.sender) revert NotOrganizer();
        if (block.timestamp >= e.startsAt + PAYOUT_DELAY) revert TooLate();
        e.cancelled = true;
        emit EventCancelled(eventId);
    }

    /// @notice The holder of a ticket for a cancelled event takes back the face price from escrow.
    /// Also covers tickets already scanned before a mid-event cancellation.
    function claimRefund(uint256 ticketId) external {
        Ticket storage t = tickets[ticketId];
        Event storage e = events[t.eventId];
        if (!e.cancelled) revert NotCancelled();
        if (t.owner != msg.sender) revert NotOwner();
        if (t.refunded) revert AlreadyUsed();
        t.refunded = true;
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

    /// @notice Current owner of a ticket; address(0) once burned.
    function ownerOf(uint256 ticketId) external view returns (address) {
        return tickets[ticketId].owner;
    }

    /// @dev A ticket that still exists, is unused, and belongs to a live event.
    function _live(uint256 ticketId) private view returns (Ticket storage t) {
        t = tickets[ticketId];
        if (t.owner == address(0) || t.used) revert AlreadyUsed();
        if (events[t.eventId].cancelled) revert Cancelled();
    }

    function _mint(uint256 eventId, address to) private returns (uint256 id) {
        uint32 max = events[eventId].maxPerWallet;
        uint256 n = ++held[eventId][to];
        if (max != 0 && n > max) revert WalletLimit();
        id = tickets.length;
        tickets.push(Ticket(uint64(eventId), false, false, to, 0));
        emit Transfer(address(0), to, id);
    }

    function _remint(uint256 oldId, address to, uint128 price) private returns (uint256 newId) {
        Ticket storage t = tickets[oldId];
        address from = t.owner;
        held[t.eventId][from]--;
        t.owner = address(0);
        t.askPrice = 0;
        emit Transfer(from, address(0), oldId);
        newId = _mint(t.eventId, to);
        emit Reminted(oldId, newId, price);
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
