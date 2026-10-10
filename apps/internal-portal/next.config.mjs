/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Lets `next build` run while `next dev` holds .next on Windows.
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  // The document reader in the browser (src/lib/free-reader) uses the API's own
  // checks on what it reads — a GSTIN's check digit, a PAN's shape — straight
  // from apps/internal-api, so the two cannot drift apart.
  experimental: { externalDir: true },
};

export default nextConfig;
