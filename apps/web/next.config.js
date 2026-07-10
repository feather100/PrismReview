/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  transpilePackages: ['@prismreview/shared-types'],
};

module.exports = nextConfig;
