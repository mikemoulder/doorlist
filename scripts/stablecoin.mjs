// The demo stablecoin "Doorlist USD" (dUSD): a native pallet_assets token on Portaldot.
//   node scripts/stablecoin.mjs create <assetId>                 create + metadata (signed by the Substrate key)
//   node scripts/stablecoin.mjs mint <assetId> <0xEvmAddress> <amount in dUSD>
//   node scripts/stablecoin.mjs info <assetId>
// Solidity sees it as an ERC-20 at the precompile address printed by `info`.
import { ApiPromise, WsProvider } from '@polkadot/api';
import { substrateSigner } from './lib/keys.mjs';

const WS_URL = process.env.WS_URL || 'wss://test-node-v3.portaldot.dev';
const DECIMALS = 6;
const [cmd, idArg, ...rest] = process.argv.slice(2);
const id = Number(idArg);
const precompile = (assetId) => `0x${assetId.toString(16).padStart(8, '0')}${'0'.repeat(24)}00010000`;

const api = await ApiPromise.create({ provider: new WsProvider(WS_URL), noInitWarn: true });

function submit(tx, signer) {
  return new Promise((resolve, reject) => {
    tx.signAndSend(signer, ({ status, dispatchError, events }) => {
      if (dispatchError) {
        const msg = dispatchError.isModule ? (({ section, name }) => `${section}.${name}`)(api.registry.findMetaError(dispatchError.asModule)) : dispatchError.toString();
        return reject(new Error(msg));
      }
      if (status.isInBlock) resolve({ block: status.asInBlock.toHex(), events: events.map((e) => `${e.event.section}.${e.event.method}`) });
    }).catch(reject);
  });
}

try {
  if (cmd === 'create') {
    if ((await api.query.assets.asset(id)).isSome) throw new Error(`asset ${id} already exists`);
    const signer = await substrateSigner();
    const r = await submit(api.tx.utility.batchAll([
      api.tx.assets.create(id, signer.address, 1),
      api.tx.assets.setMetadata(id, 'Doorlist USD', 'dUSD', DECIMALS),
    ]), signer);
    console.log(`created asset ${id} in ${r.block}: ${r.events.filter((e) => e.startsWith('assets')).join(', ')}`);
  } else if (cmd === 'mint') {
    const [evmAddress, amount] = rest;
    const signer = await substrateSigner();
    const beneficiary = (await api.call.reviveApi.accountId(evmAddress)).toString(); // H160 -> its Substrate twin
    const units = BigInt(Math.round(Number(amount) * 10 ** DECIMALS));
    const r = await submit(api.tx.assets.mint(id, beneficiary, units), signer);
    console.log(`minted ${amount} dUSD to ${evmAddress} (${beneficiary}) in ${r.block}`);
  }
  if (cmd === 'info' || cmd === 'create' || cmd === 'mint') {
    const a = await api.query.assets.asset(id);
    const m = (await api.query.assets.metadata(id)).toHuman();
    console.log(`asset ${id}: ${m.name} (${m.symbol}), ${m.decimals} decimals, supply ${a.isSome ? a.unwrap().supply.toString() : 'none'}`);
    console.log(`ERC-20 precompile: ${precompile(id)}`);
  }
} finally {
  await api.disconnect();
}
process.exit(0);
