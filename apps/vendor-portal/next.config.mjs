/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  /**
   * Lets `next build` run while someone else's `next dev` holds `.next`.
   *
   * `next dev --turbo` and `next build` write incompatible artifacts into the
   * same directory, and the result fails at request time rather than at build
   * time — every route 500s with "Expected to use Webpack bindings ... but the
   * current process is referencing the Turbopack bindings". Several sessions
   * share this tree, so a private output directory is the only reliable way to
   * serve a production build here. Mirrors `apps/internal-portal`.
   */
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
};

export default nextConfig;
