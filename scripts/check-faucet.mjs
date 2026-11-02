// Live check of DusdFaucet: claim once from the wallet's Ethereum key, then confirm a second
// claim is refused (simulated with eth_call, costs nothing). Prints pool and wallet balances.
import { createRequire } from 'node:module';
import { ethereumKey } from './lib/keys.mjs';

const require = createRequire(import.meta.url);
const { ethers } = require('../contracts/node_modules/ethers');
const f = require('../deployments/dusd-faucet.json');

const provider = new ethers.JsonRpcProvider(f.rpc, f.chainId, { staticNetwork: true });
const wallet = new ethers.Wallet((await ethereumKey()).privateKey, provider);
const faucet = new ethers.Contract(f.address, f.abi, wallet);
const usd = new ethers.Contract(f.token, ['function balanceOf(address) view returns (uint256)'], provider);
const fmt = (x) => ethers.formatUnits(x, 6);
const show = async (label) => console.log(
  `${label}: pool ${fmt(await usd.balanceOf(f.address))} dUSD, wallet ${fmt(await usd.balanceOf(wallet.address))} dUSD`);

await show('start');
if (await faucet.claimed(wallet.address)) {
  console.log('wallet already claimed, skipping the real claim');
} else {
  const before = await provider.getBalance(wallet.address);
  const gasPrice = BigInt(await provider.send('eth_gasPrice', []));
  const r = await (await faucet.claim({ type: 0, gasPrice })).wait();
  console.log(`claim: block ${r.blockNumber}, status ${r.status}, cost ${ethers.formatEther(before - await provider.getBalance(wallet.address))} tPOT`);
  await show('after claim');
}
try {
  await faucet.claim.staticCall();
  throw new Error('second claim was NOT refused');
} catch (e) {
  const name = e.revert?.name ?? faucet.interface.parseError(e.data ?? '0x')?.name;
  if (name !== 'AlreadyClaimed') throw e;
  console.log('second claim: refused with AlreadyClaimed');
}
