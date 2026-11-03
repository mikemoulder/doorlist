# Doorlist web app

The static frontend for [Doorlist](../README.md). It has no server: every screen reads the Portaldot V3 testnet
contract directly (`lib/deployment.json` holds the address and ABI).

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # static export to out/, then tools/check-chunks.mjs checks every chunk parses
```

| Path | What lives there |
|---|---|
| `lib/doorlist.ts` | Every contract read, from storage (see the architecture doc for why not logs) |
| `lib/wallet.tsx` | Sign-in chooser and writes for Ethereum-style wallets |
| `lib/substrate.ts` | Portaldot Wallet: `revive.call` writes, dry runs, signing |
| `lib/pass.ts` | The rotating door code and its verification |
| `lib/media.ts` | Event media in `transactionStorage` |
| `tools/` | A loader that works around an SWC minifier bug in `@scure/sr25519`, and the chunk check |

Architecture: [docs/architecture.md](../docs/architecture.md).
