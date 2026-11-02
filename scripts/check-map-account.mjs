// Live check of the first sign-in step for a brand-new Portaldot account: revive.mapAccount.
// Makes a throwaway sr25519 key in memory (never printed or saved), funds it with 5 tPOT from the
// wallet's Substrate key, maps it, reports the cost and resulting contract address, then sends the
// free balance back. The mapping deposit stays reserved on the throwaway account.
import { ApiPromise, WsProvider } from '@polkadot/api';
import { Keyring } from '@polkadot/keyring';
import { mnemonicGenerate } from '@polkadot/util-crypto';
import { substrateSigner } from './lib/keys.mjs';

const api = await ApiPromise.create({ provider: new WsProvider(process.env.WS_URL || 'wss://test-node-v3.portaldot.dev'), noInitWarn: true });
const main = await substrateSigner();
const temp = new Keyring({ type: 'sr25519', ss58Format: 42 }).addFromMnemonic(mnemonicGenerate());
const UNIT = 10n ** 14n;
const acct = async (a) => (await api.query.system.account(a)).data;
const show = (x) => (Number(x) / 1e14).toFixed(4);

function submit(tx, who) {
  return new Promise((resolve, reject) => {
    tx.signAndSend(who, ({ status, dispatchError }) => {
      if (dispatchError) {
        const msg = dispatchError.isModule ? (({ section, name }) => `${section}.${name}`)(api.registry.findMetaError(dispatchError.asModule)) : dispatchError.toString();
        return reject(new Error(msg));
      }
      if (status.isInBlock) resolve(status.asInBlock.toHex());
    }).catch(reject);
  });
}

try {
  await submit(api.tx.balances.transferKeepAlive(temp.address, 5n * UNIT), main);
  const h160 = (await api.call.reviveApi.address(temp.address)).toString();
  console.log(`throwaway ${temp.address} funded with 5 tPOT, contract address ${h160}`);
  console.log(`mapped before: ${(await api.query.revive.originalAccount(h160)).isSome}`);
  const before = await acct(temp.address);
  console.log(`mapAccount in ${await submit(api.tx.revive.mapAccount(), temp)}`);
  const after = await acct(temp.address);
  const mapped = await api.query.revive.originalAccount(h160);
  console.log(`mapped after: ${mapped.isSome && mapped.unwrap().toString() === temp.address}`);
  console.log(`cost: fee ${show(before.free.toBigInt() - after.free.toBigInt() - (after.reserved.toBigInt() - before.reserved.toBigInt()))} tPOT, deposit reserved ${show(after.reserved.toBigInt() - before.reserved.toBigInt())} tPOT`);
  await submit(api.tx.balances.transferAll(main.address, false), temp);
  console.log(`returned the free balance; throwaway keeps ${show((await acct(temp.address)).reserved.toBigInt())} tPOT reserved`);
} finally {
  await api.disconnect();
}
