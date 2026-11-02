import type { NextConfig } from 'next';

// Static export: the app has no server. Every screen reads the Portaldot chain directly.
const nextConfig: NextConfig = {
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  webpack(config) {
    // Our own chunk registry name. Wallet extensions that inject Next.js-built scripts share the default
    // `webpackChunk_N_E`; that broke chunks loaded on demand (polkadot.js on sign-in): "Loading chunk failed (missing)".
    config.output.chunkLoadingGlobal = 'webpackChunk_doorlist';
    config.output.uniqueName = 'doorlist';
    return config;
  },
};

export default nextConfig;
