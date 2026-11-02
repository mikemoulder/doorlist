require('@nomicfoundation/hardhat-ethers');
require('@nomicfoundation/hardhat-chai-matchers');
require('dotenv').config({ path: '../.env' });

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: '0.8.24',
    // Small bytecode matters more than cheap calls: Revive charges a storage deposit per byte of code.
    settings: { optimizer: { enabled: true, runs: 1 }, viaIR: true, evmVersion: 'cancun' },
  },
  networks: {
    portaldot: {
      url: process.env.EVM_RPC || 'https://test-evm-rpc-v3.portaldot.dev',
      chainId: 420420777,
      // The deployer key is decrypted at runtime from the wallet backup (scripts/lib/keys.mjs),
      // never stored in this file or in .env.
    },
  },
};
