/** multer memory uploads with size/count limits and a magic-byte check (JPEG, PNG, WebP only). */
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import multer from 'multer';
import { HttpError } from './errors.ts';

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_FILES = 4;

export type ImageMime = 'image/jpeg' | 'image/png' | 'image/webp';

/** Identify an image by its leading bytes; the client-declared type is never trusted. */
export function detectImageMime(buffer: Buffer): ImageMime | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 4 && buffer.readUInt32BE(0) === 0x89504e47) return 'image/png';
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

export const EXTENSION_FOR: Record<ImageMime, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const uploader = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES, fields: 10, parts: 20 },
});

function translate(err: unknown): HttpError {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') return new HttpError(413, 'FILE_TOO_LARGE', 'Each photo must be 5 MB or smaller.');
    if (err.code === 'LIMIT_FILE_COUNT') return new HttpError(400, 'VALIDATION_FAILED', `Upload at most ${MAX_FILES} photos.`);
    return new HttpError(400, 'VALIDATION_FAILED', 'The upload was not understood.');
  }
  return err instanceof HttpError ? err : new HttpError(400, 'VALIDATION_FAILED', 'The upload was not understood.');
}

function checkMagicBytes(files: Express.Multer.File[]): void {
  for (const file of files) {
    if (!detectImageMime(file.buffer)) {
      throw new HttpError(415, 'UNSUPPORTED_FILE', 'Photos must be JPEG, PNG or WebP images.');
    }
  }
}

function wrap(handler: RequestHandler): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res, (err?: unknown) => {
      if (err) return next(translate(err));
      try {
        const files = req.files;
        checkMagicBytes(Array.isArray(files) ? files : req.file ? [req.file] : []);
        next();
      } catch (checkError) {
        next(checkError);
      }
    });
  };
}

/** One image in the multipart field `field` (available as req.file). */
export const uploadPhoto = (field: string): RequestHandler => wrap(uploader.single(field));

/** Up to `maxCount` images in `field` (available as req.files). */
export const uploadPhotos = (field: string, maxCount: number = MAX_FILES): RequestHandler =>
  wrap(uploader.array(field, Math.min(maxCount, MAX_FILES)));
