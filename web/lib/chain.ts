import { createPublicClient, defineChain, http, type Address } from 'viem';
import deployment from './deployment.json';

export const portaldot = defineChain({
  id: deployment.chainId,
  name: 'Portaldot V3 Testnet',
  nativeCurrency: { name: 'Portaldot', symbol: 'POT', decimals: 18 },
  rpcUrls: { default: { http: [deployment.rpc] } },
});

export const SUBSTRATE_WS = 'wss://test-node-v3.portaldot.dev';
export const EXPLORER = 'https://node-console.portaldot.dev';

export const DOORLIST = deployment.address as Address;
export const TREASURY = deployment.treasury as Address;
export const DEPLOY_BLOCK = BigInt(deployment.block);
export const doorlistAbi = deployment.abi;

/** Doorlist USD: native asset 2026, reached from Solidity through its ERC-20 precompile. */
export const DUSD = {
  assetId: 2026,
  address: '0x000007ea00000000000000000000000000010000' as Address,
  symbol: 'dUSD',
  decimals: 6,
};
export const NATIVE = '0x0000000000000000000000000000000000000000' as Address;

export const client = createPublicClient({ chain: portaldot, transport: http(deployment.rpc, { retryCount: 3 }) });

export const erc20Abi = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'allowance', stateMutability: 'view', inputs: [{ name: 'o', type: 'address' }, { name: 's', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 's', type: 'address' }, { name: 'v', type: 'uint256' }], outputs: [{ type: 'bool' }] },
] as const;
