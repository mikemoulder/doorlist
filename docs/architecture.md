# Doorlist architecture

Doorlist sells event tickets on Portaldot V3 that can't be faked or copied. The chain is the
only backend: no server, no database. A static web app talks to one Solidity contract on
Portaldot's Revive EVM, and payments use either native tPOT or a Portaldot native asset
through its ERC-20 precompile.

```text
 Organizer / Buyer wallet             Door phone
 (MetaMask)                           (door key, no wallet popups)
        |                                   |
        |  createEvent, buy, list,          |  1. scan QR, verify pass + signature
        |  buyResale, withdraw              |  2. checkIn(ticketId)
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
| 3 | Guest buys a ticket, for themselves or as a gift | Approve + buy from their wallet, optionally entering a friend's address | Payment goes into escrow; a ticket token is minted to the chosen wallet |
| 4 | Guest opens the ticket on a phone | Wallet signs a device pass once; the phone signs `ticketId + time` every 10s for the QR | none |
| 5 | **Door scans: VALID** (the aha moment) | Pass signed by `ownerOf(ticketId)`, device signature under 30s old, ticket unused | `checkIn` marks it used |
| 6 | **Same QR or a screenshot: REFUSED** | Stale timestamp, or the ticket is used | `checkIn` reverts `AlreadyUsed` |
| 7 | Resale at any price | List, then someone buys it for themselves or a friend | Old token burned, new one minted; the old QR dies with the old id |

## Why it can't be faked or copied

- **No copying:** tickets belong to wallets. A phone shows the QR only after the owner's wallet signs a pass for it, and the QR is re-signed every 10s, so a screenshot expires.
- **Burn and re-mint:** every resale burns the old token and mints a new one, so passes and QR codes made for the old id stop working.
- **No free transfers:** a ticket only changes hands through a paid resale. Gifts are purchases with the friend's address as the recipient, so fees, royalties and wallet limits always apply.
- **No double entry:** `checkIn` flips `used` on-chain. Two doors can't both admit the same ticket.
- **No bulk buying:** organizers set a per-wallet limit per event, enforced on first sales and resales.
- **No custody:** the contract never holds funds. Payments go from the buyer to each recipient in the same transaction.

## Economics

| Flow | Treasury (Doorlist) | Organizer | Seller |
|---|---|---|---|
| First sale (escrowed, paid from `startsAt + 24h`) | 3% | 97% | none |
| Resale (seller sets any price) | 3% | royalty, 0 to 10%, chosen per event | the rest |
| Cancelled event | nothing | can never withdraw | each holder claims 100% back from escrow |

- **Creating an event is free.** The storage deposit Portaldot charges for on-chain data already makes spam cost money, and a creation fee would discourage the organizers who bring volume.
- **Cancelling** marks the event cancelled and blocks sales, resales and check-ins. On-chain data can't be deleted.

## Event media (pictures and ticket designs)

Stored on Portaldot itself, in the runtime's `transactionStorage` pallet, not on IPFS or a server.

- The organizer's app bundles the event picture, ticket design and details into one file and
  submits `transactionStorage.store` (up to 8 MB per transaction, a fee of 10 planck per byte).
- The contract publishes the location (`tstore:<block>:<index>:<blake2-256>`) in a `UriSet` log.
  The app reads the latest one with `eth_getLogs`, fetches the block from the node, and checks
  the hash.
- **Data expires after 100,800 blocks (about 7 days)** unless renewed. Each `renew` moves it to a
  new block, so the organizer calls `setUri` with the new location. The dashboard does both.
- Verified on 2026-11-02: a 50 KB file stored in about 8 seconds at block 291334 and read back
  byte-identical from the public node (`scripts/tstore.mjs`).

## Decisions

| Decision | Why | Instead of |
|---|---|---|
| A lean ticket registry, not a full ERC-721 | Revive charges about 0.08 tPOT per byte of code; this contract costs about 408 tPOT to deploy | OpenZeppelin ERC-721 |
| Compiled with the IR optimizer (`viaIR`) | Cut the bytecode by about 20% (5,843 to 4,607 bytes, before cancel and refund) | The default pipeline |
| Signatures checked off-chain by the door app | No `ecrecover` gas per scan, and the door works offline for the signature step | On-chain signature checks |
| Each event names its currency | One contract serves tPOT and any native asset | Hardcoding one token |
| Static frontend over the EVM HTTP RPC | No server to host or break; HTTP is unaffected by the WebSocket drops seen on the Substrate endpoint | Next.js API routes or a database |
| Ticket list from `eth_getLogs` | Verified that the RPC serves logs | An indexer |
| Media pointer in a log (`UriSet`), not contract storage | A stored string added 905 bytes of code (about 48 tPOT to deploy) and a storage deposit on every event | A `uri` field in the event struct |
| Media in `transactionStorage` | Portaldot-native, no server, almost free per byte | IPFS with a pinning service (permanent, but needs an API key and a server function) |

## Repo map

```text
contracts/contracts/Doorlist.sol   the contract
contracts/test/                    Hardhat tests (logic, both currencies)
scripts/                           key handling, funding, asset creation, deploy
web/                               static frontend (next step)
```
