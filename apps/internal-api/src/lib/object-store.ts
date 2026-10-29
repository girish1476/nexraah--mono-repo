import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The private bucket, reached over Supabase Storage's S3 protocol.
 *
 * Why not the Supabase JS client: with the anon key (the only key part 14 §4
 * allows) a private bucket with deny-all policies refuses every write and
 * every signature, so no upload could ever succeed on a hosted project. The
 * alternative it names — `service_role` — is the one key this design bans,
 * because it also opens Postgres. Storage's S3 access keys (Dashboard →
 * Storage → S3 Connection) reach the bucket and nothing else.
 *
 *   STORAGE_S3_ENDPOINT           https://<ref>.storage.supabase.co/storage/v1/s3
 *   STORAGE_S3_REGION             the project's region, e.g. ap-south-1
 *   STORAGE_S3_ACCESS_KEY_ID      ┐ Storage → S3 Connection → New access key
 *   STORAGE_S3_SECRET_ACCESS_KEY  ┘
 *
 * Reads are never handed out as bucket URLs. A file is shown through a link
 * this API signs itself — `fileLink()` — valid 15 minutes and minted only
 * after the caller was checked against the row (part 14 §7); `GET
 * /files/:token` verifies it and streams the object.
 */

export interface S3Config {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

export function s3Config(env: Record<string, string | undefined> = process.env): S3Config | null {
  const endpoint = env.STORAGE_S3_ENDPOINT?.replace(/\/$/, '');
  const { STORAGE_S3_REGION: region, STORAGE_S3_ACCESS_KEY_ID: accessKeyId, STORAGE_S3_SECRET_ACCESS_KEY: secretAccessKey } = env;
  if (!endpoint || !region || !accessKeyId || !secretAccessKey) return null;
  return { endpoint, region, accessKeyId, secretAccessKey, bucket: env.STORAGE_BUCKET || 'nexraah' };
}

/* ---- AWS Signature Version 4 ---------------------------------------------------- */

const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const hmac = (key: string | Buffer, data: string) => createHmac('sha256', key).update(data).digest();

/** RFC 3986 encoding of each path segment, as SigV4's canonical URI requires. */
export function encodePath(path: string): string {
  return path
    .split('/')
    .map((s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join('/');
}

/**
 * Signs one request. Every header passed is signed; `host`,
 * `x-amz-content-sha256` and `x-amz-date` are added. Returns the headers to send.
 */
export function signV4(input: {
  method: string;
  url: URL;
  headers?: Record<string, string>;
  body?: Buffer | string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  now?: Date;
  payloadHash?: string;
}): Record<string, string> {
  const now = input.now ?? new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const payloadHash = input.payloadHash ?? sha256(input.body ?? '');
  const headers: Record<string, string> = {
    ...Object.fromEntries(Object.entries(input.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v.trim()])),
    host: input.url.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  const names = Object.keys(headers).sort();
  const query = [...input.url.searchParams.entries()]
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .sort()
    .join('&');
  const canonical = [
    input.method,
    input.url.pathname,
    query,
    names.map((n) => `${n}:${headers[n]}\n`).join(''),
    names.join(';'),
    payloadHash,
  ].join('\n');
  const scope = `${day}/${input.region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  const key = hmac(hmac(hmac(hmac(`AWS4${input.secretAccessKey}`, day), input.region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', key).update(toSign).digest('hex');
  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`,
  };
}

/* ---- the bucket --------------------------------------------------------------- */

export class ObjectStoreError extends Error {}

async function call(c: S3Config, method: string, path: string, body?: Buffer, contentType?: string): Promise<Response> {
  const url = new URL(`${c.endpoint}/${encodePath(c.bucket)}/${encodePath(path)}`);
  const headers = signV4({
    method,
    url,
    body,
    headers: contentType ? { 'content-type': contentType } : {},
    region: c.region,
    accessKeyId: c.accessKeyId,
    secretAccessKey: c.secretAccessKey,
  });
  delete headers.host; // fetch sets it, from the URL signed above
  const response = await fetch(url, { method, headers, body: body ? new Uint8Array(body) : undefined });
  if (!response.ok && !(method === 'DELETE' && response.status === 404)) {
    const text = await response.text().catch(() => '');
    const reason = text.match(/<Message>([^<]*)<\/Message>/)?.[1] ?? text.slice(0, 200);
    throw new ObjectStoreError(`storage answered ${response.status}: ${reason || response.statusText}`);
  }
  return response;
}

export async function putObject(c: S3Config, path: string, body: Buffer, mime: string): Promise<void> {
  await call(c, 'PUT', path, body, mime);
}

export async function getObject(c: S3Config, path: string): Promise<{ body: Buffer; mime: string }> {
  const response = await call(c, 'GET', path);
  return { body: Buffer.from(await response.arrayBuffer()), mime: response.headers.get('content-type') ?? 'application/octet-stream' };
}

export async function deleteObject(c: S3Config, path: string): Promise<void> {
  await call(c, 'DELETE', path);
}

/* ---- links this API signs itself ------------------------------------------------ */

const LINK_TTL_SECONDS = 15 * 60;

function linkKey(c: S3Config): Buffer {
  // Derived, so there is no second secret to set: whoever holds the storage key
  // could read the files anyway.
  return createHash('sha256').update(`nexraah-file-links:${c.secretAccessKey}`).digest();
}

/** This API's own address, for links it hands out. Render sets RENDER_EXTERNAL_URL itself. */
export function publicApiBase(env: Record<string, string | undefined> = process.env): string {
  const base = (env.PUBLIC_API_URL || env.RENDER_EXTERNAL_URL || `http://localhost:${env.PORT ?? 4002}`).replace(/\/$/, '');
  return base.endsWith('/api/v1') ? base : `${base}/api/v1`;
}

/** A link to one file, good for 15 minutes. Mint it only after checking the caller may see the row. */
export function fileLink(c: S3Config, path: string, now = Date.now()): { url: string; expiresAt: string } {
  const exp = Math.floor(now / 1000) + LINK_TTL_SECONDS;
  const payload = Buffer.from(JSON.stringify({ p: path, e: exp })).toString('base64url');
  const mac = createHmac('sha256', linkKey(c)).update(payload).digest('base64url');
  return { url: `${publicApiBase()}/files/${payload}.${mac}`, expiresAt: new Date(exp * 1000).toISOString() };
}

/** The path a link names, or null when it was altered or has run out. */
export function openFileLink(c: S3Config, token: string, now = Date.now()): string | null {
  const [payload, mac] = token.split('.');
  if (!payload || !mac) return null;
  const expected = Buffer.from(createHmac('sha256', linkKey(c)).update(payload).digest('base64url'));
  const offered = Buffer.from(mac);
  if (expected.length !== offered.length || !timingSafeEqual(expected, offered)) return null;
  try {
    const { p, e } = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { p?: unknown; e?: unknown };
    if (typeof p !== 'string' || typeof e !== 'number' || e * 1000 < now) return null;
    return p;
  } catch {
    return null;
  }
}
