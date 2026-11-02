// Moves tPOT from the wallet's Substrate key to its Ethereum key (through the Revive fallback account),
// so Hardhat/MetaMask can deploy from the EVM key. Usage: node scripts/fund-evm.mjs [amountTpot=450]
import 'dotenv/config';
import fs from 'node:fs';
import { Keyring } from '@polkadot/keyring';
import { cryptoWaitReady, jsonDecrypt } from '@polkadot/util-crypto';
import { u8aToString } from '@polkadot/util';
import { ApiPromise, WsProvider } from '@polkadot/api';

const { KEYSTORE_FILE = './wallet.keystore.json', KEYSTORE_PASSWORD, WS_URL = 'wss://test-node-v3.portaldot.dev' } = process.env;
const amount = BigInt(process.argv[2] ?? 450) * 10n ** 14n; // tPOT has 14 decimals
await cryptoWaitReady();

const file = JSON.parse(fs.readFileSync(KEYSTORE_FILE, 'utf8'));
const entries = JSON.parse(u8aToString(jsonDecrypt(file, KEYSTORE_PASSWORD)));
const load = (type) => {
  const json = entries.find((e) => e.encoding?.content?.[1] === type);
  const pair = new Keyring({ type, ss58Format: 42 }).addFromJson(json);
  pair.decodePkcs8(KEYSTORE_PASSWORD);
  return pair;
};
const sub = load('sr25519');
const eth = load('ethereum');

const api = await ApiPromise.create({ provider: new WsProvider(WS_URL), noInitWarn: true });
const dest = (await api.call.reviveApi.accountId(eth.address)).toString(); // H160 -> Substrate fallback account
console.log(`Sending ${Number(amount) / 1e14} tPOT  ${sub.address} -> ${dest} (EVM ${eth.address})`);

await new Promise((resolve, reject) => {
  api.tx.balances.transferKeepAlive(dest, amount).signAndSend(sub, ({ status, dispatchError, txHash }) => {
    if (dispatchError) return reject(new Error(dispatchError.toString()));
    if (status.isInBlock) console.log(`in block ${status.asInBlock.toHex()} (tx ${txHash.toHex()})`);
    if (status.isFinalized) resolve();
  }).catch(reject);
});

const { data } = await api.query.system.account(sub.address);
console.log(`Substrate key now: ${Number(data.free.toBigInt()) / 1e14} tPOT`);
await api.disconnect();
