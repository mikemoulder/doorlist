// Deploys DusdFaucet (one batch of test dUSD per address) to Portaldot V3 from the wallet's Ethereum key.
//   node scripts/deploy-faucet.mjs          dry run: estimated cost, sends nothing
//   node scripts/deploy-faucet.mjs --send   deploys, checks token() and amount() on-chain, writes deployments/
// Fill the pool afterwards: node scripts/stablecoin.mjs mint 2026 <faucet address> 50000
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { ethereumKey } from './lib/keys.mjs';

const require = createRequire(import.meta.url);
const { ethers } = require('../contracts/node_modules/ethers');
const artifact = require('../contracts/artifacts/contracts/DusdFaucet.sol/DusdFaucet.json');

const RPC = process.env.EVM_RPC || 'https://test-evm-rpc-v3.portaldot.dev';
const DUSD = '0x000007ea00000000000000000000000000010000'; // asset 2026
const AMOUNT = 100_000_000n; // 100.00 dUSD (6 decimals)
const send = process.argv.includes('--send');

const provider = new ethers.JsonRpcProvider(RPC, 420420777, { staticNetwork: true });
const wallet = new ethers.Wallet((await ethereumKey()).privateKey, provider);
const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
const tx = await factory.getDeployTransaction(DUSD, AMOUNT);
const [gas, gasPrice, balance] = await Promise.all([
  provider.estimateGas({ ...tx, from: wallet.address }),
  provider.send('eth_gasPrice', []).then(BigInt),
  provider.getBalance(wallet.address),
]);
console.log(`deployer ${wallet.address}, balance ${ethers.formatEther(balance)} tPOT`);
console.log(`estimate ${ethers.formatEther(gas * gasPrice)} tPOT (gas ${gas}, price ${gasPrice})`);
if (gas * gasPrice > balance) throw new Error('not enough tPOT');
if (!send) {
  console.log('dry run only. Re-run with --send to deploy.');
  process.exit(0);
}

const contract = await factory.deploy(DUSD, AMOUNT, { type: 0, gasLimit: (gas * 11n) / 10n, gasPrice });
const receipt = await contract.deploymentTransaction().wait();
const at = await contract.getAddress();
const after = await provider.getBalance(wallet.address);
console.log(`deployed ${at} in block ${receipt.blockNumber}, status ${receipt.status}`);
console.log(`token() ${await contract.token()}, amount() ${await contract.amount()}`);
console.log(`spent ${ethers.formatEther(balance - after)} tPOT; left ${ethers.formatEther(after)}`);
if ((await contract.token()).toLowerCase() !== DUSD || (await contract.amount()) !== AMOUNT) throw new Error('deployment check failed');

fs.writeFileSync('deployments/dusd-faucet.json', JSON.stringify({
  network: 'Portaldot V3 testnet',
  chainId: 420420777,
  rpc: RPC,
  contract: 'DusdFaucet',
  address: at,
  token: DUSD,
  amount: AMOUNT.toString(),
  txHash: receipt.hash,
  block: receipt.blockNumber,
  deployedAt: new Date().toISOString(),
  abi: artifact.abi,
}, null, 2) + '\n');
console.log('wrote deployments/dusd-faucet.json');
