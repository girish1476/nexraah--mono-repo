import type { MetadataRoute } from 'next';

/**
 * Not for the public web. See the matching file in `internal-portal` — same
 * reasoning, and the `X-Robots-Tag` header in `vercel.json` is the half that
 * binds for crawlers which ignore robots.txt.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', disallow: '/' },
  };
}
