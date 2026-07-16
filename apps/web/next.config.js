/** @type {import('next').NextConfig} */
const nextConfig = {
  // NOTE: standalone output intentionally omitted. It requires symlink
  // creation (next trace -> .next/standalone), which is blocked by Windows
  // file-permission (EPERM) without Developer Mode. Default output works for
  // both `next dev` and a regular `next start`. Re-enable only if you build a
  // production Docker image on a symlink-capable host.
  transpilePackages: ['@prismreview/shared-types'],
};

module.exports = nextConfig;
