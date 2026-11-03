import type { NextConfig } from 'next';

// Static export: the app has no server. Every screen reads the Portaldot chain directly.
const nextConfig: NextConfig = {
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  webpack(config) {
    // Our own chunk registry name instead of the default `webpackChunk_N_E`, so scripts injected by other
    // Next.js-built code (e.g. wallet extensions) can never share it. Defensive only: it was not the cause of
    // the sign-in failure, which was the SWC bug below.
    config.output.chunkLoadingGlobal = 'webpackChunk_doorlist';
    config.output.uniqueName = 'doorlist';
    // SWC minifier bug: @scure/sr25519's `proving${'\0'}0` becomes an invalid octal escape. See tools/fix-sr25519-loader.cjs.
    config.module.rules.push({
      test: /[\\/]node_modules[\\/]@scure[\\/]sr25519[\\/].*\.js$/,
      use: [{ loader: require.resolve('./tools/fix-sr25519-loader.cjs') }],
    });
    return config;
  },
};

export default nextConfig;
