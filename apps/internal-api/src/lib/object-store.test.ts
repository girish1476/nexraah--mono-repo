import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodePath, fileLink, openFileLink, publicApiBase, s3Config, signV4, type S3Config } from './object-store';

describe('SigV4', () => {
  it('matches the GET Object example in the AWS Signature Version 4 documentation', () => {
    // docs.aws.amazon.com — "Signature Calculations for the Authorization Header", example: GET Object.
    const headers = signV4({
      method: 'GET',
      url: new URL('https://examplebucket.s3.amazonaws.com/test.txt'),
      headers: { range: 'bytes=0-9' },
      region: 'us-east-1',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      now: new Date('2013-05-24T00:00:00Z'),
    });
    expect(headers.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, ' +
        'SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, ' +
        'Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
    );
  });

  it('encodes each path segment the way the canonical URI needs', () => {
    expect(encodePath('pod/t 1/a(1)*.pdf')).toBe('pod/t%201/a%281%29%2A.pdf');
  });
});

describe('configuration', () => {
  it('needs all four storage settings', () => {
    const full = {
      STORAGE_S3_ENDPOINT: 'https://ref.storage.supabase.co/storage/v1/s3/',
      STORAGE_S3_REGION: 'ap-south-1',
      STORAGE_S3_ACCESS_KEY_ID: 'id',
      STORAGE_S3_SECRET_ACCESS_KEY: 'secret',
      STORAGE_BUCKET: 'nexraah',
    };
    expect(s3Config(full)).toMatchObject({ endpoint: 'https://ref.storage.supabase.co/storage/v1/s3', bucket: 'nexraah' });
    expect(s3Config({ ...full, STORAGE_S3_SECRET_ACCESS_KEY: '' })).toBeNull();
  });

  it('builds links on the address Render gives the service', () => {
    expect(publicApiBase({ RENDER_EXTERNAL_URL: 'https://nexraah-internal-api.onrender.com' })).toBe(
      'https://nexraah-internal-api.onrender.com/api/v1',
    );
    expect(publicApiBase({ PUBLIC_API_URL: 'https://api.nexraah.com/api/v1/' })).toBe('https://api.nexraah.com/api/v1');
  });
});

describe('file links', () => {
  afterEach(() => vi.unstubAllEnvs());
  const c: S3Config = { endpoint: 'https://x/storage/v1/s3', region: 'r', accessKeyId: 'id', secretAccessKey: 'secret', bucket: 'nexraah' };
  const now = Date.parse('2026-10-29T10:00:00Z');

  it('open to the path they were made for, for 15 minutes', () => {
    vi.stubEnv('PUBLIC_API_URL', 'https://api.test');
    const { url, expiresAt } = fileLink(c, 'pod/t-1/a.pdf', now);
    expect(url.startsWith('https://api.test/api/v1/files/')).toBe(true);
    expect(expiresAt).toBe('2026-10-29T10:15:00.000Z');
    const token = url.split('/files/')[1];
    expect(openFileLink(c, token, now + 14 * 60_000)).toBe('pod/t-1/a.pdf');
    expect(openFileLink(c, token, now + 16 * 60_000)).toBeNull();
  });

  it('refuse a link altered to name another file, or signed with another key', () => {
    const token = fileLink(c, 'pod/t-1/a.pdf', now).url.split('/files/')[1];
    const [, mac] = token.split('.');
    const other = Buffer.from(JSON.stringify({ p: 'kyc/v-9/aadhaar.png', e: now / 1000 + 900 })).toString('base64url');
    expect(openFileLink(c, `${other}.${mac}`, now)).toBeNull();
    expect(openFileLink({ ...c, secretAccessKey: 'other' }, token, now)).toBeNull();
    expect(openFileLink(c, 'garbage', now)).toBeNull();
  });
});
