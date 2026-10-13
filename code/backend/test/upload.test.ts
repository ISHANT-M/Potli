import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { detectImageMime, MAX_FILE_BYTES, uploadPhoto, uploadPhotos } from '../src/http/upload.ts';
import { makeMiniApp } from './helpers.ts';

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)]);
const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(32)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 '), Buffer.alloc(16)]);

describe('detectImageMime', () => {
  it('recognises JPEG, PNG and WebP by magic bytes', () => {
    expect(detectImageMime(JPEG)).toBe('image/jpeg');
    expect(detectImageMime(PNG)).toBe('image/png');
    expect(detectImageMime(WEBP)).toBe('image/webp');
  });

  it('rejects everything else', () => {
    expect(detectImageMime(Buffer.from('GIF89a'))).toBeNull();
    expect(detectImageMime(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(detectImageMime(Buffer.from('RIFFxxxxWAVEfmt '))).toBeNull();
    expect(detectImageMime(Buffer.alloc(0))).toBeNull();
  });
});

describe('upload middleware', () => {
  const app = makeMiniApp((mini: express.Express) => {
    mini.post('/one', uploadPhoto('photo'), (req, res) => res.json({ size: req.file?.size }));
    mini.post('/many', uploadPhotos('photos', 4), (req, res) => res.json({ count: (req.files as unknown[]).length }));
  });

  it('accepts an image whatever the declared type', async () => {
    const res = await request(app).post('/one').attach('photo', PNG, { filename: 'a.txt', contentType: 'text/plain' });
    expect(res.status).toBe(200);
  });

  it('rejects a non-image disguised as one with 415', async () => {
    const res = await request(app).post('/one').attach('photo', Buffer.from('<?php echo 1;'), { filename: 'a.png', contentType: 'image/png' });
    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe('UNSUPPORTED_FILE');
  });

  it('rejects files over 5 MB with 413', async () => {
    const big = Buffer.concat([JPEG, Buffer.alloc(MAX_FILE_BYTES)]);
    const res = await request(app).post('/one').attach('photo', big, { filename: 'big.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('FILE_TOO_LARGE');
  });

  it('limits the number of files', async () => {
    let req = request(app).post('/many');
    for (let i = 0; i < 5; i += 1) req = req.attach('photos', JPEG, { filename: `p${i}.jpg`, contentType: 'image/jpeg' });
    expect((await req).status).toBe(400);
    const ok = await request(app).post('/many').attach('photos', JPEG, 'a.jpg').attach('photos', PNG, 'b.png');
    expect(ok.body.count).toBe(2);
  });
});
