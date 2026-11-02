// Live check of the path the official Portaldot Wallet would use: a Substrate (5...) account calling
// a Solidity contract through pallet_revive, with no Ethereum key involved.
//   1. revive.mapAccount once, so the account has a contract-side address (H160)
//   2. dry-run faucet.claim() with the reviveApi.call runtime API for weight and storage deposit
//   3. send it as a revive.call extrinsic, then read the dUSD balance of the mapped address
// Signs with the wallet backup's sr25519 key.
import { createRequire } from 'node:module';
import { ApiPromise, WsProvider } from '@polkadot/api';
import { substrateSigner } from './lib/keys.mjs';

const require = createRequire(import.meta.url);
const { ethers } = require('../contracts/node_modules/ethers');
const f = require('../deployments/dusd-faucet.json');

const WS_URL = process.env.WS_URL || 'wss://test-node-v3.portaldot.dev';
const api = await ApiPromise.create({ provider: new WsProvider(WS_URL), noInitWarn: true });
const signer = await substrateSigner();
const usd = new ethers.Contract(f.token, ['function balanceOf(address) view returns (uint256)'], new ethers.JsonRpcProvider(f.rpc, f.chainId, { staticNetwork: true }));
const faucet = new ethers.Interface(f.abi);
const pot = async () => Number((await api.query.system.account(signer.address)).data.free.toBigInt()) / 1e14;

function submit(tx) {
  return new Promise((resolve, reject) => {
    tx.signAndSend(signer, ({ status, dispatchError, events }) => {
      if (dispatchError) {
        const msg = dispatchError.isModule ? (({ section, name }) => `${section}.${name}`)(api.registry.findMetaError(dispatchError.asModule)) : dispatchError.toString();
        return reject(new Error(msg));
      }
      if (status.isInBlock) resolve({ block: status.asInBlock.toHex(), events: events.map(({ event }) => `${event.section}.${event.method}`) });
    }).catch(reject);
  });
}

try {
  const h160 = (await api.call.reviveApi.address(signer.address)).toString();
  console.log(`account ${signer.address} -> contract address ${h160}, ${await pot()} tPOT`);

  if ((await api.query.revive.originalAccount(h160)).isNone) {
    const before = await pot();
    const r = await submit(api.tx.revive.mapAccount());
    console.log(`mapAccount in ${r.block}, cost ${(before - await pot()).toFixed(4)} tPOT`);
  } else {
    console.log('already mapped');
  }

  const data = faucet.encodeFunctionData('claimed', [h160]);
  const claimedRaw = await api.call.reviveApi.call(signer.address, f.address, 0, null, null, data);
  const already = claimedRaw.result.isOk && BigInt(claimedRaw.result.asOk.data.toHex()) === 1n;
  console.log(`faucet.claimed(${h160}) = ${already}; dUSD ${ethers.formatUnits(await usd.balanceOf(h160), 6)}`);

  const input = faucet.encodeFunctionData('claim');
  const dry = await api.call.reviveApi.call(signer.address, f.address, 0, null, null, input);
  const reverted = dry.result.isErr || (dry.result.asOk.flags.bits.toNumber() & 1);
  console.log(`dry run: ${dry.result.isErr ? dry.result.asErr.toString() : `flags ${dry.result.asOk.flags.bits.toNumber()}`}, weight ${dry.weightRequired.toString()}, max deposit ${dry.maxStorageDeposit.toString()}`);

  if (already) {
    if (!reverted) throw new Error('a second claim was NOT refused in the dry run');
    const err = faucet.parseError(dry.result.asOk.data.toHex());
    console.log(`second claim refused in dry run: ${err?.name}`);
  } else {
    if (reverted) throw new Error('dry run reverted');
    const limit = dry.maxStorageDeposit.isCharge ? dry.maxStorageDeposit.asCharge.toBigInt() : 0n;
    const before = await pot();
    const r = await submit(api.tx.revive.call(f.address, 0, dry.weightRequired, limit, input));
    console.log(`revive.call claim() in ${r.block}: ${r.events.filter((e) => e.startsWith('revive') || e.startsWith('assets')).join(', ')}`);
    console.log(`cost ${(before - await pot()).toFixed(4)} tPOT; dUSD now ${ethers.formatUnits(await usd.balanceOf(h160), 6)}`);
  }
} finally {
  await api.disconnect();
}
