// End-to-end check of the stablecoin path on the live Doorlist contract, with real dUSD:
// approve -> createEvent (dUSD) -> buy (precompile transferFrom into escrow)
// -> cancelEvent -> claimRefund (precompile transfer out of escrow).
// Uses the wallet's Ethereum key as organizer and buyer. Prints tPOT spent per step.
import { createRequire } from 'node:module';
import { ethereumKey } from './lib/keys.mjs';

const require = createRequire(import.meta.url);
const { ethers } = require('../contracts/node_modules/ethers');
const d = require('../deployments/portaldot-testnet.json');

const DUSD = '0x000007ea00000000000000000000000000010000'; // asset 2026
const MEDIA = 'tstore:291334:1:0x582196170e8d0e01962f18509e8579a80b821cf6d1e7abfac11cba975f443f03';
const PRICE = 25_000_000n; // 25.00 dUSD

const provider = new ethers.JsonRpcProvider(d.rpc, d.chainId, { staticNetwork: true });
const wallet = new ethers.Wallet((await ethereumKey()).privateKey, provider);
const dl = new ethers.Contract(d.address, d.abi, wallet);
const usd = new ethers.Contract(DUSD, [
  'function approve(address,uint256) returns (bool)',
  'function allowance(address,address) view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
], wallet);

const fmt = (x) => ethers.formatUnits(x, 6);
async function step(label, send) {
  const before = await provider.getBalance(wallet.address);
  const tx = await send();
  const r = await tx.wait();
  const after = await provider.getBalance(wallet.address);
  console.log(`${label.padEnd(34)} block ${r.blockNumber}  status ${r.status}  cost ${ethers.formatEther(before - after)} tPOT`);
  return r;
}
const balances = async (label) => console.log(
  `  ${label}: buyer ${fmt(await usd.balanceOf(wallet.address))} dUSD, contract ${fmt(await usd.balanceOf(d.address))} dUSD`);

console.log(`wallet ${wallet.address}, ${ethers.formatEther(await provider.getBalance(wallet.address))} tPOT`);
await balances('start');

if ((await usd.allowance(wallet.address, d.address)) < PRICE) {
  await step('approve Doorlist on the precompile', () => usd.approve(d.address, ethers.MaxUint256));
}
const startsAt = Math.floor(Date.now() / 1000) + 2 * 24 * 3600;
const created = await step('createEvent (priced in dUSD)', () =>
  dl.createEvent('Stablecoin check', startsAt, 10, PRICE, DUSD, 0, 500, MEDIA));
const eventId = dl.interface.parseLog(created.logs.find((l) => l.address.toLowerCase() === d.address.toLowerCase())).args.eventId;
console.log(`  event #${eventId}`);

const bought = await step('buy (transferFrom into escrow)', () => dl.buy(eventId, wallet.address));
const ticketId = bought.logs
  .map((l) => { try { return dl.interface.parseLog(l); } catch { return null; } })
  .find((e) => e?.name === 'Transfer').args.tokenId;
console.log(`  ticket #${ticketId}, owner ${await dl.ownerOf(ticketId)}, escrowed ${fmt((await dl.events(eventId)).escrowed)} dUSD`);
await balances('after buy');

await step('cancelEvent', () => dl.cancelEvent(eventId));
await step('claimRefund (transfer out of escrow)', () => dl.claimRefund(ticketId));
console.log(`  escrowed ${fmt((await dl.events(eventId)).escrowed)} dUSD, refunded flag ${(await dl.tickets(ticketId)).refunded}`);
await balances('after refund');
console.log(`wallet left ${ethers.formatEther(await provider.getBalance(wallet.address))} tPOT`);
