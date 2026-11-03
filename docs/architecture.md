# Doorlist architecture

Doorlist sells event tickets on Portaldot V3 that can't be copied. The chain is the only backend: no
server, no database. A static web app talks to one Solidity contract on Portaldot's `pallet_revive`, and
payments use native POT or a Portaldot native asset (dUSD) through its ERC-20 precompile.

```text
 Portaldot Wallet (5... account)        Ethereum-style wallet (Rabby, MetaMask)
   revive.call extrinsic                  eth_sendRawTransaction via the EVM RPC
            \                                   /
             v                                 v
 +-----------------------------------------------------------+       Door phone
 |  Doorlist.sol  on pallet_revive (chain id 420420777)      | <--- checkIn, signed by
 |  events[], tickets[], isDoor[event][door], held[...]      |      the door's own key
 +-----------------------------------------------------------+
        | transferFrom / transfer                  ^
        v                                          | claim(): 100 dUSD once per account
 dUSD: native asset 2026 via its ERC-20 precompile  DusdFaucet.sol
 0x000007ea00000000000000000000000000010000

 Event media: one JSON bundle per event in transactionStorage, located by a UriSet log
```

## The demo path

| Step | User does | App does | Chain does |
|---|---|---|---|
| 1 | Organizer creates an event, priced in dUSD | Stores the media bundle, then calls `createEvent` | Event stored; `UriSet` points at the media |
| 2 | Organizer approves a door phone | The door page makes a key; the organizer pastes its address | `setDoor(event, door, true)`, plus 1 POT sent to the door for fees |
| 3 | Guest claims test dUSD and buys, for themselves or as a gift | Faucet `claim`, dUSD `approve`, `buy(eventId, to)` | Price into escrow; a ticket token for the chosen wallet |
| 4 | Guest opens the ticket on a phone | The wallet signs a pass for that phone once; the phone signs `ticketId + time` every 10 s | none |
| 5 | **Door scans: VALID** | Pass signed by the ticket owner, code under 30 s old, ticket unused | `checkIn` marks it used |
| 6 | **Same code again, or a screenshot: REFUSED** | Code too old, or the ticket is already used | `checkIn` would revert `AlreadyUsed` |
| 7 | Resale | List at any price; a buyer buys it for themselves or a friend | Old token burned, new one minted; the old codes die with the old id |

## Two ways into one contract

- **Portaldot Wallet** (the official extension, a polkadot.js-style wallet) exposes only Substrate accounts.
  `web/lib/substrate.ts` encodes the Solidity call, dry-runs it with the `reviveApi.call` runtime API (weight,
  storage deposit, and the contract's own revert reason), then sends `revive.call` signed in the extension. The
  contract sees the account as `reviveApi.address(ss58)`; funded accounts are already mapped on this chain, and the
  app calls `revive.mapAccount` only if one is not. Values convert from 18 to 14 decimals (native POT).
- **Ethereum-style wallets** send legacy transactions with an exact gas price through the EVM RPC
  (`web/lib/wallet.tsx`). EIP-1559 transactions ask for more balance than exists on this node.

**Reads come from contract storage, not logs.** Portaldot's Ethereum RPC indexes only Ethereum-style
transactions, so a `revive.call` leaves no trace in `eth_getLogs`. `web/lib/doorlist.ts` walks the public
`events` and `tickets` arrays. The media link exists only in the `UriSet` log, so for events created from a
Portaldot Wallet the app binary-searches the creation block with historical `eth_call`, then reads that block's
`revive.ContractEmitted` events on the Substrate side. The answer is cached in the browser.

## Why a ticket can't be copied

- **Tickets belong to wallets.** A phone shows a code only after the owner's wallet signs a pass for that phone.
- **Codes expire.** The phone re-signs every 10 seconds and the door refuses anything older than 30 seconds.
- **One entry.** `checkIn` flips `used` on-chain, so two doors can't both admit the same ticket.
- **No side deals.** A ticket changes hands only through a paid resale in the contract; every resale burns the
  old token and mints a new one. Gifts are purchases with a friend's address as the recipient.
- **No bulk buying.** Organizers set a per-wallet limit, enforced on first sales and resales.
- **Signatures for both wallet types.** Ethereum signatures (65 bytes) are recovered with ecrecover. Portaldot
  Wallet signatures (64 bytes, sr25519) are verified against the owner's 5... account, looked up with
  `revive.originalAccount` (`web/lib/pass.ts`).

## Money

| Flow | Doorlist treasury | Organizer | Seller |
|---|---|---|---|
| First sale (held in escrow, paid out from `startsAt + 24h`) | 3% | 97% | none |
| Resale (seller sets any price, paid out at once) | 3% | royalty, 0 to 10%, chosen per event | the rest |
| Cancelled event | nothing | can never withdraw | each holder claims 100% back from escrow |

Creating an event has no Doorlist fee. Portaldot's storage deposit (about 20 POT for an event, up to about 15 POT
for a ticket on testnet) already makes spam cost money.

## Event media

Stored on Portaldot itself, in the runtime's `transactionStorage` pallet.

- The organizer's app bundles the picture, ticket design and details into one JSON file and submits
  `transactionStorage.store`, signed by a 5... account.
- The contract publishes the location (`tstore:<block>:<index>:<blake2-256>`) in a `UriSet` log. The app fetches
  that block from the node and checks the hash before showing anything.
- **Data expires after about 7 days (100,800 blocks) unless renewed.** Renewal is not built yet. A second copy on
  IPFS via Pinata is planned: the link format would carry both locations, and the same hash would verify both.

## Decisions

| Decision | Why | Instead of |
|---|---|---|
| A lean ticket registry, not a full ERC-721 | Revive charges about 0.078 POT per byte of code; Doorlist cost 461 POT to deploy | OpenZeppelin ERC-721 |
| Signatures checked by the door app | No signature gas per scan, and the signature step works offline | On-chain signature checks |
| Each event names its currency | One contract serves POT and any native asset | Hardcoding one token |
| Static frontend, chain as the backend | Nothing to host or break besides static files | API routes and a database |
| Reads from storage arrays | The EVM RPC does not index `revive.call` logs | An indexer |
| Media pointer in a log | A stored string added 905 bytes of code (about 48 POT) and a deposit per event | A `uri` field in the event struct |
| Media in `transactionStorage` | Portaldot-native, no server, almost free per byte | IPFS only |
| A dUSD faucet contract | Judges have POT for gas but no dUSD; only the asset issuer can mint | Sending dUSD by hand |

## Repo map

```text
contracts/contracts/Doorlist.sol     the ticket contract
contracts/contracts/DusdFaucet.sol   100 dUSD once per account
contracts/test/                      Hardhat tests (21)
deployments/                         addresses and ABIs on Portaldot V3 testnet
scripts/                             deploy, fund, mint dUSD, and live checks against the testnet
web/lib/                             chain reads (doorlist.ts), wallets (wallet.tsx, substrate.ts), QR pass (pass.ts), media
web/app/                             screens: /, /events, /event, /tickets, /ticket, /door, /organize
web/tools/                           build fix for an SWC minifier bug, and a check that every chunk parses
```
