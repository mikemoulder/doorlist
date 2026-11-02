// Store a file in Portaldot's transactionStorage and read it back.
//   node scripts/tstore.mjs put <file>            -> prints tstore:<block>:<index>
//   node scripts/tstore.mjs get <block> <index> [out]
// Signs with the wallet's Substrate key (decrypted from the backup in .env). Prints no secrets.
import 'dotenv/config';
import fs from 'node:fs';
import { Keyring } from '@polkadot/keyring';
import { cryptoWaitReady, jsonDecrypt, blake2AsHex } from '@polkadot/util-crypto';
import { u8aToString, u8aToHex } from '@polkadot/util';
import { ApiPromise, WsProvider } from '@polkadot/api';

const { KEYSTORE_FILE = './wallet.keystore.json', KEYSTORE_PASSWORD, WS_URL = 'wss://test-node-v3.portaldot.dev' } = process.env;
const [cmd, ...args] = process.argv.slice(2);
await cryptoWaitReady();
const api = await ApiPromise.create({ provider: new WsProvider(WS_URL), noInitWarn: true });

if (cmd === 'put') {
  const data = fs.readFileSync(args[0]);
  const file = JSON.parse(fs.readFileSync(KEYSTORE_FILE, 'utf8'));
  const json = JSON.parse(u8aToString(jsonDecrypt(file, KEYSTORE_PASSWORD))).find((e) => e.encoding?.content?.[1] === 'sr25519');
  const signer = new Keyring({ type: 'sr25519', ss58Format: 42 }).addFromJson(json);
  signer.decodePkcs8(KEYSTORE_PASSWORD);
  console.log(`storing ${data.length} bytes, blake2-256 ${blake2AsHex(data)}`);
  const t0 = Date.now();
  await new Promise((resolve, reject) => {
    api.tx.transactionStorage.store(u8aToHex(data)).signAndSend(signer, ({ status, events, dispatchError }) => {
      if (dispatchError) return reject(new Error(dispatchError.toString()));
      if (!status.isInBlock) return;
      const blockHash = status.asInBlock;
      for (const { event, phase } of events) {
        if (api.events.transactionStorage.Stored.is(event)) {
          api.rpc.chain.getHeader(blockHash).then((h) => {
            console.log(`Stored event: ${JSON.stringify(event.data.toHuman())}`);
            console.log(`location: tstore:${h.number.toNumber()}:${phase.asApplyExtrinsic.toNumber()}  (${Date.now() - t0} ms)`);
            resolve();
          });
        }
      }
    }).catch(reject);
  });
} else if (cmd === 'get') {
  const [block, index, out] = args;
  const hash = await api.rpc.chain.getBlockHash(Number(block));
  const { block: b } = await api.rpc.chain.getBlock(hash);
  const xt = b.extrinsics[Number(index)];
  const { section, method } = xt.method;
  if (section !== 'transactionStorage' || method !== 'store') throw new Error(`extrinsic ${index} is ${section}.${method}`);
  const data = xt.method.args[0].toU8a(true);
  console.log(`read ${data.length} bytes from block ${block} #${index}, blake2-256 ${blake2AsHex(data)}`);
  if (out) fs.writeFileSync(out, data);
} else {
  console.log('usage: put <file> | get <block> <index> [out]');
}
await api.disconnect();
process.exit(0);
