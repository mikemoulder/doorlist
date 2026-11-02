// Loads keys from the wallet backup (wallet.keystore.json + KEYSTORE_PASSWORD in .env).
// Secrets stay in memory; nothing here prints or writes them.
import 'dotenv/config';
import fs from 'node:fs';
import { Keyring } from '@polkadot/keyring';
import { decodePair } from '@polkadot/keyring/pair/decode';
import { cryptoWaitReady, jsonDecrypt, base64Decode } from '@polkadot/util-crypto';
import { u8aToString, u8aToHex } from '@polkadot/util';

const { KEYSTORE_FILE = './wallet.keystore.json', KEYSTORE_PASSWORD } = process.env;

async function entries() {
  if (!KEYSTORE_PASSWORD) throw new Error('Set KEYSTORE_PASSWORD in .env');
  await cryptoWaitReady();
  const file = JSON.parse(fs.readFileSync(KEYSTORE_FILE, 'utf8'));
  return file.encoding?.content?.includes('batch-pkcs8')
    ? JSON.parse(u8aToString(jsonDecrypt(file, KEYSTORE_PASSWORD)))
    : [file];
}

/** The sr25519 Substrate signer, as a @polkadot/keyring pair. */
export async function substrateSigner() {
  const json = (await entries()).find((e) => e.encoding?.content?.[1] === 'sr25519');
  const pair = new Keyring({ type: 'sr25519', ss58Format: 42 }).addFromJson(json);
  pair.decodePkcs8(KEYSTORE_PASSWORD);
  return pair;
}

/** The Ethereum key as { address, privateKey } for ethers. */
export async function ethereumKey() {
  const json = (await entries()).find((e) => e.encoding?.content?.[1] === 'ethereum');
  const { secretKey } = decodePair(KEYSTORE_PASSWORD, base64Decode(json.encoded), json.encoding.type);
  const pair = new Keyring({ type: 'ethereum' }).addFromJson(json);
  return { address: pair.address, privateKey: u8aToHex(secretKey.slice(0, 32)) };
}
