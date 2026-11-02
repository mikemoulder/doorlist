// Sends tPOT from the wallet's Substrate key to any 5... address (test accounts for the demo).
//   node scripts/send-tpot.mjs <ss58 address> <amount in tPOT>
import { ApiPromise, WsProvider } from '@polkadot/api';
import { decodeAddress, encodeAddress } from '@polkadot/util-crypto';
import { substrateSigner } from './lib/keys.mjs';

const [to, amountArg] = process.argv.slice(2);
if (!to || !amountArg) throw new Error('usage: node scripts/send-tpot.mjs <ss58 address> <amount in tPOT>');
if (encodeAddress(decodeAddress(to), 42) !== to) throw new Error(`not a Portaldot (prefix 42) address: ${to}`);
const amount = BigInt(Math.round(Number(amountArg) * 1e4)) * 10n ** 10n; // 14 decimals

const api = await ApiPromise.create({ provider: new WsProvider(process.env.WS_URL || 'wss://test-node-v3.portaldot.dev'), noInitWarn: true });
const signer = await substrateSigner();
const free = async (a) => Number((await api.query.system.account(a)).data.free.toBigInt()) / 1e14;
try {
  console.log(`from ${signer.address} (${await free(signer.address)} tPOT) to ${to} (${await free(to)} tPOT): ${amountArg} tPOT`);
  const block = await new Promise((resolve, reject) => {
    api.tx.balances.transferKeepAlive(to, amount).signAndSend(signer, ({ status, dispatchError }) => {
      if (dispatchError) return reject(new Error(dispatchError.toString()));
      if (status.isInBlock) resolve(status.asInBlock.toHex());
    }).catch(reject);
  });
  console.log(`in block ${block}; recipient now ${await free(to)} tPOT, sender ${await free(signer.address)} tPOT`);
} finally {
  await api.disconnect();
}
