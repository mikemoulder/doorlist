// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @dev The subset of ERC-20 we use. On Portaldot, native `pallet_assets` tokens expose it
/// through a precompile at 0x{assetId:8 hex}000000000000000000000000{00010000}.
interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @title Doorlist: tickets that can't be faked or scalped.
/// @notice Each ticket stores a "ticket key": an address whose private key lives only on
/// the holder's phone. The phone signs a fresh (ticketId, timestamp) every few seconds for
/// its QR code; the door app checks that signature against `tickets[id].key` off-chain,
/// then calls `checkIn`. A screenshot expires, a copied QR fails the key check, and a
/// second check-in reverts.
contract Doorlist {
    struct Event {
        address organizer;
        uint64 startsAt;
        uint32 capacity;
        uint32 sold;
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

    event EventCreated(uint256 indexed eventId, address indexed organizer, string name);
    event DoorSet(uint256 indexed eventId, address indexed door, bool allowed);
    event TicketBought(uint256 indexed ticketId, uint256 indexed eventId, address indexed owner, address key);
    event Listed(uint256 indexed ticketId, uint128 price);
    event Resold(uint256 indexed ticketId, address indexed from, address indexed to, uint128 price);
    event KeyRotated(uint256 indexed ticketId, address key);
    event CheckedIn(uint256 indexed ticketId, uint256 indexed eventId, address door);

    error NotOrganizer();
    error NotOwner();
    error NotDoor();
    error SoldOut();
    error WrongPayment();
    error AlreadyUsed();
    error AboveFacePrice();
    error NotListed();
    error PayoutFailed();

    function createEvent(string calldata name, uint64 startsAt, uint32 capacity, uint128 price, address currency)
        external
        returns (uint256 eventId)
    {
        eventId = events.length;
        events.push(Event(msg.sender, startsAt, capacity, 0, price, currency, name));
        emit EventCreated(eventId, msg.sender, name);
    }

    function setDoor(uint256 eventId, address door, bool allowed) external {
        if (events[eventId].organizer != msg.sender) revert NotOrganizer();
        isDoor[eventId][door] = allowed;
        emit DoorSet(eventId, door, allowed);
    }

    function buy(uint256 eventId, address key) external payable returns (uint256 ticketId) {
        Event storage e = events[eventId];
        if (e.sold >= e.capacity) revert SoldOut();
        e.sold++;
        ticketId = tickets.length;
        tickets.push(Ticket(uint64(eventId), false, msg.sender, key, 0));
        emit TicketBought(ticketId, eventId, msg.sender, key);
        _collect(e.currency, e.price, e.organizer);
    }

    /// @notice List a ticket for resale. The price can't exceed face value: scalping doesn't pay.
    function list(uint256 ticketId, uint128 price) external {
        Ticket storage t = tickets[ticketId];
        if (t.owner != msg.sender) revert NotOwner();
        if (t.used) revert AlreadyUsed();
        if (price > events[t.eventId].price) revert AboveFacePrice();
        t.askPrice = price;
        emit Listed(ticketId, price);
    }

    function buyResale(uint256 ticketId, address newKey) external payable {
        Ticket storage t = tickets[ticketId];
        uint128 price = t.askPrice;
        if (price == 0 || t.used) revert NotListed();
        address seller = t.owner;
        t.owner = msg.sender;
        t.key = newKey; // the seller's phone key stops working immediately
        t.askPrice = 0;
        emit Resold(ticketId, seller, msg.sender, price);
        _collect(events[t.eventId].currency, price, seller);
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
        if (t.used) revert AlreadyUsed();
        t.used = true;
        t.askPrice = 0;
        emit CheckedIn(ticketId, t.eventId, msg.sender);
    }

    function eventCount() external view returns (uint256) {
        return events.length;
    }

    function ticketCount() external view returns (uint256) {
        return tickets.length;
    }

    /// @dev Moves `amount` from the buyer straight to `to`. The contract never holds funds.
    function _collect(address currency, uint256 amount, address to) private {
        if (currency == address(0)) {
            if (msg.value != amount) revert WrongPayment();
            if (amount == 0) return;
            (bool ok,) = to.call{value: amount}("");
            if (!ok) revert PayoutFailed();
        } else {
            if (msg.value != 0) revert WrongPayment();
            if (!IERC20(currency).transferFrom(msg.sender, to, amount)) revert PayoutFailed();
        }
    }
}
