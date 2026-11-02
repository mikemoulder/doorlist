# Doorlist architecture

Doorlist sells event tickets on Portaldot V3 that can't be faked or scalped. The chain is the
only backend: no server, no database. A static web app talks to one Solidity contract on
Portaldot's Revive EVM, and payments use either native tPOT or a Portaldot native asset
through its ERC-20 precompile.

```text
 Organizer / Buyer browser            Door phone
 (MetaMask)                           (burner door key, no wallet popups)
        |                                   |
        |  createEvent, buy, list,          |  1. scan QR, verify signature locally
        |  buyResale, rotateKey             |  2. checkIn(ticketId)
        v                                   v
 +--------------------------------------------------+
 |  Doorlist.sol  (pallet_revive, chain 420420777)  |
 |  events[], tickets[], isDoor[event][door]        |
 +--------------------------------------------------+
        |  transferFrom (stablecoin events)
        v
 Native asset ERC-20 precompile  0x{assetId}000000000000000000000000 00010000
 (a pallet_assets token, created with assets.create)
```

## The demo path

| Step | User does | App does | Chain does |
|---|---|---|---|
| 1 | Organizer creates "Demo Day", 25 dUSD, 50 seats | MetaMask tx | `createEvent` stores the event |
| 2 | Organizer opens the door page on a phone | Generates a door key, organizer authorizes it | `setDoor(event, doorKey, true)` |
| 3 | Guest buys a ticket | Generates a **ticket key** on the guest's device, approve + buy | `transferFrom` guest to organizer, ticket stores the key |
| 4 | Guest opens the ticket | QR = `ticketId`, timestamp, signature by the ticket key, refreshed every 10s | none |
| 5 | **Door scans: VALID** (the aha moment) | Signature recovers to `tickets[id].key`, under 30s old, not used | `checkIn` marks it used |
| 6 | **Same QR or a screenshot: REFUSED** | Stale timestamp, or `used == true` | `checkIn` reverts `AlreadyUsed` |
| 7 | Resale at face value | List, then another guest buys with a new key | Seller paid; the old key stops working |

## Why it can't be faked or scalped

- **No copying:** the QR is signed every 10s by a key that never leaves the guest's device. A screenshot expires, and a forwarded link has no key.
- **No double entry:** `checkIn` flips `used` on-chain. Two doors can't both admit the same ticket.
- **No scalping:** resale only goes through the contract, at face value or below. When a ticket is resold, the seller's key dies.
- **No custody:** the contract never holds funds. Payments go from buyer to organizer or seller in the same transaction.

## Decisions

| Decision | Why | Instead of |
|---|---|---|
| A lean ticket registry, not a full ERC-721 | Revive charges about 0.08 tPOT per byte of code; this contract costs about 395 tPOT to deploy | OpenZeppelin ERC-721 |
| Signatures checked off-chain by the door app | No `ecrecover` gas per scan, and the door works offline for the signature step | On-chain signature checks |
| Each event names its currency | One contract serves tPOT and any native asset | Hardcoding one token |
| Static frontend over the EVM HTTP RPC | No server to host or break; HTTP is unaffected by the WebSocket drops seen on the Substrate endpoint | Next.js API routes or a database |
| Ticket list from `eth_getLogs` | Verified that the RPC serves logs | An indexer |

## Repo map

```text
contracts/contracts/Doorlist.sol   the contract
contracts/test/                    Hardhat tests (logic, both currencies)
scripts/                           key handling, funding, asset creation, deploy
web/                               static frontend (next step)
```
