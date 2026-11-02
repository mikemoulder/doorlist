import type { NextConfig } from 'next';

// Static export: the app has no server. Every screen reads the Portaldot chain directly.
const nextConfig: NextConfig = {
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
