/**
 * social — image + file upload API (platform, 8888).
 *
 * The upload endpoints are on the AuthInterceptor allow-list (`/​*​/upload`), so
 * they need no accessToken. Backed by MinIO in this environment. Shapes are
 * live-verified.
 *
 * Contract (live):
 *  - POST /image/upload  multipart `file` (+ isPermanent, thumbSize)
 *      -> Result<UploadImageVO {originUrl, thumbUrl, width, height}>
 *  - POST /file/upload   multipart `file`
 *      -> Result<String>  (data is a plain access URL)
 *
 * Note: image upload rejects malformed/undersized bitmaps ("图片上传失败"); we
 * upload a real, dimension-valid PNG built here with zlib so the thumbnail
 * pipeline succeeds.
 *
 * Env:
 *  - SOCIAL_BASE_URL      platform backend (8888). Tests skip when unset.
 */
import { test, expect, baseURLFor } from '../fixtures';
import { apiContext } from '../../../shared/api';
import { deflateSync } from 'node:zlib';
import type { Envelope } from '../helpers/auth';

const platformURL = () => baseURLFor('social');

function skipIfNoPlatform() {
  test.skip(!platformURL(), 'SOCIAL_BASE_URL not configured');
}

/** Build a valid RGB PNG of the given size (real IHDR + zlib IDAT + CRCs). */
function makePng(w = 16, h = 16): Buffer {
  const crcTable: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  const crc32 = (buf: Buffer) => {
    let c = ~0;
    for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (~c) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const t = Buffer.from(type, 'ascii');
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([t, data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0; // filter byte
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = (x * 16) & 255;
      raw[o + 1] = (y * 16) & 255;
      raw[o + 2] = 128;
    }
  }
  const idat = deflateSync(raw);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// SO-API-056 (P1) — image upload returns original + thumbnail URLs.
test("【文件与媒体上传 / API】 SO-API-056 上传图片返回原图与缩略图", async () => {
  skipIfNoPlatform();
  const ctx = await apiContext(platformURL()!);
  try {
    const res = await ctx.post('/image/upload', {
      multipart: { file: { name: 'e2e.png', mimeType: 'image/png', buffer: makePng(16, 16) } },
    });
    const body = (await res.json()) as Envelope<{
      originUrl: string;
      thumbUrl: string;
      width: number;
      height: number;
    }>;
    expect(body.code).toBe(200);
    expect(body.data.originUrl).toMatch(/^https?:\/\//);
    expect(body.data.thumbUrl).toMatch(/^https?:\/\//);
    expect(body.data.width).toBe(16);
    expect(body.data.height).toBe(16);
  } finally {
    await ctx.dispose();
  }
});

// SO-API-058 (P2) — an over-limit file upload is rejected (multipart max 50MB).
// Live: a 55MB body -> HTTP 200 envelope {code:500,"系统繁忙..."} (the multipart
// size guard trips before the upload succeeds), no URL returned.
test("【文件与媒体上传 / API】 SO-API-058 超大文件上传被拒", async () => {
  skipIfNoPlatform();
  test.slow(); // building + sending a 55MB body takes a while
  const ctx = await apiContext(platformURL()!);
  try {
    const oversized = Buffer.alloc(55 * 1024 * 1024, 0x41); // 55MB > 50MB limit
    const res = await ctx.post('/file/upload', {
      multipart: {
        file: { name: 'huge.bin', mimeType: 'application/octet-stream', buffer: oversized },
      },
    });
    const body = (await res.json()) as Envelope<string | null>;
    expect(body.code).not.toBe(200);
    expect(body.data).toBeFalsy();
  } finally {
    await ctx.dispose();
  }
});
test("【文件与媒体上传 / API】 SO-API-057 上传文件返回 URL", async () => {
  skipIfNoPlatform();
  const ctx = await apiContext(platformURL()!);
  try {
    const res = await ctx.post('/file/upload', {
      multipart: {
        file: { name: 'e2e.txt', mimeType: 'text/plain', buffer: Buffer.from('hello e2e file') },
      },
    });
    const body = (await res.json()) as Envelope<string>;
    expect(body.code).toBe(200);
    expect(typeof body.data).toBe('string');
    expect(body.data).toMatch(/^https?:\/\//);
  } finally {
    await ctx.dispose();
  }
});
