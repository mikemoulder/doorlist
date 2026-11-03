// Decrypts the wallet backup with the password from .env and prints ONLY public addresses + balances.
// Handles both a single-account keystore and a SubWallet/polkadot-js "batch-pkcs8" export.
// Never prints the password, seed or private keys.
import 'dotenv/config';
import fs from 'node:fs';
import { Keyring } from '@polkadot/keyring';
import { cryptoWaitReady, jsonDecrypt } from '@polkadot/util-crypto';
import { u8aToString } from '@polkadot/util';
import { ApiPromise, WsProvider } from '@polkadot/api';

const {
  KEYSTORE_FILE = './wallet.keystore.json',
  KEYSTORE_PASSWORD,
  EXPECTED_ADDRESS = '5G9p1xhSJsE1vjNtHXmXFZ6rxdWEpCEBkD4KWL5Pvic7LGuw',
  WS_URL = 'wss://test-node-v3.portaldot.dev',
  EVM_RPC = 'https://test-evm-rpc-v3.portaldot.dev',
} = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== '')); // empty .env values fall back to the defaults

if (!KEYSTORE_PASSWORD) { console.error('Set KEYSTORE_PASSWORD in .env'); process.exit(1); }
await cryptoWaitReady();

const file = JSON.parse(fs.readFileSync(KEYSTORE_FILE, 'utf8'));
const isBatch = file.encoding?.content?.includes('batch-pkcs8');

// A batch export decrypts to an array of per-account keystore JSONs (each also password-encrypted).
const entries = isBatch
  ? JSON.parse(u8aToString(jsonDecrypt(file, KEYSTORE_PASSWORD)))
  : [file];

const found = {};
for (const json of entries) {
  const type = json.encoding?.content?.[1];
  if (!['sr25519', 'ed25519', 'ecdsa', 'ethereum'].includes(type)) continue; // skip BTC/TON keys
  const kr = new Keyring({ type, ss58Format: 42 });
  const pair = kr.addFromJson(json);
  pair.decodePkcs8(KEYSTORE_PASSWORD);
  found[type] = pair.address;
  console.log(`${type.padEnd(8)} ${pair.address}${pair.address === EXPECTED_ADDRESS ? '  MATCH ✓' : ''}`);
}

const api = await ApiPromise.create({ provider: new WsProvider(WS_URL), noInitWarn: true });
for (const [type, addr] of Object.entries(found)) {
  if (type === 'ethereum') {
    const r = await fetch(EVM_RPC, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getBalance', params: [addr, 'latest'] }) }).then(r => r.json());
    console.log(`EVM ${addr}: ${Number(BigInt(r.result)) / 1e18} tPOT`);
  } else {
    const { data } = await api.query.system.account(addr);
    const h160 = await api.call.reviveApi.address(addr);
    console.log(`Substrate ${addr}: ${Number(data.free.toBigInt()) / 1e14} tPOT (EVM view ${h160})`);
  }
}
await api.disconnect();
