// Deploys Doorlist to Portaldot V3 from the wallet's Ethereum key.
//   node scripts/deploy.mjs          dry run: checks the key, balance and estimated cost, sends nothing
//   node scripts/deploy.mjs --send   deploys, verifies the code and treasury on-chain, writes deployments/
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { ethereumKey } from './lib/keys.mjs';

const require = createRequire(import.meta.url);
const { ethers } = require('../contracts/node_modules/ethers');
const artifact = require('../contracts/artifacts/contracts/Doorlist.sol/Doorlist.json');

const RPC = process.env.EVM_RPC || 'https://test-evm-rpc-v3.portaldot.dev';
const EXPECTED_DEPLOYER = '0x7037c4641EDdE15B807e31de2D6aa7233202019D';
const send = process.argv.includes('--send');

const { address, privateKey } = await ethereumKey();
if (address.toLowerCase() !== EXPECTED_DEPLOYER.toLowerCase()) throw new Error(`key derives ${address}, expected ${EXPECTED_DEPLOYER}`);
const provider = new ethers.JsonRpcProvider(RPC, 420420777, { staticNetwork: true });
const wallet = new ethers.Wallet(privateKey, provider);
if (wallet.address !== ethers.getAddress(address)) throw new Error('private key does not match the keystore address');

const treasury = wallet.address;
const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
const tx = await factory.getDeployTransaction(treasury);
const [gas, feeData, balance] = await Promise.all([
  provider.estimateGas({ ...tx, from: wallet.address }),
  provider.getFeeData(),
  provider.getBalance(wallet.address),
]);
const cost = gas * feeData.gasPrice;
console.log(`deployer ${wallet.address}`);
console.log(`balance  ${ethers.formatEther(balance)} tPOT`);
console.log(`estimate ${ethers.formatEther(cost)} tPOT (gas ${gas}, price ${feeData.gasPrice})`);
if (cost > balance) throw new Error('not enough tPOT');
if (!send) {
  console.log('dry run only. Re-run with --send to deploy.');
  process.exit(0);
}

const contract = await factory.deploy(treasury, { gasLimit: gas, gasPrice: feeData.gasPrice });
const deployTx = contract.deploymentTransaction();
console.log(`sent     ${deployTx.hash}`);
const receipt = await deployTx.wait();
const at = await contract.getAddress();
const code = await provider.getCode(at);
const onchainTreasury = await contract.treasury();
const after = await provider.getBalance(wallet.address);
console.log(`deployed ${at} in block ${receipt.blockNumber}, status ${receipt.status}`);
console.log(`code     ${(code.length - 2) / 2} bytes on-chain; treasury() = ${onchainTreasury}`);
console.log(`spent    ${ethers.formatEther(balance - after)} tPOT; left ${ethers.formatEther(after)}`);
if (code === '0x' || onchainTreasury !== treasury) throw new Error('deployment check failed');

fs.mkdirSync('deployments', { recursive: true });
fs.writeFileSync('deployments/portaldot-testnet.json', JSON.stringify({
  network: 'Portaldot V3 testnet',
  chainId: 420420777,
  rpc: RPC,
  contract: 'Doorlist',
  address: at,
  treasury,
  deployer: wallet.address,
  txHash: deployTx.hash,
  block: receipt.blockNumber,
  deployedAt: new Date().toISOString(),
  abi: artifact.abi,
}, null, 2) + '\n');
console.log('wrote deployments/portaldot-testnet.json');
