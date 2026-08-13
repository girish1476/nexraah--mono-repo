/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Lets `next build` run while `next dev` holds .next on Windows.
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
};

export default nextConfig;
