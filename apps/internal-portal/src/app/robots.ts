import type { MetadataRoute } from 'next';

/**
 * This console is never for the public web, in any environment. Even the
 * stakeholder demo runs on fixture data that looks exactly like real client
 * pricing and transporter bank details, and an indexed screenshot of it is
 * indistinguishable from a leak of the real thing.
 *
 * Paired with the `X-Robots-Tag` header in `vercel.json` — the header is what
 * actually binds for crawlers that ignore robots.txt, this is the polite half.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', disallow: '/' },
  };
}
