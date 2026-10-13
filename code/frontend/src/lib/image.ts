/** Shrink a photo in the browser before upload: longest side 1600px, JPEG at quality 0.8. */

export const MAX_SIDE = 1600;
export const JPEG_QUALITY = 0.8;

export function fitWithin(width: number, height: number, maxSide: number = MAX_SIDE): { width: number; height: number } {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

export async function compressImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const { width, height } = fitWithin(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Your browser could not process that photo.');
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Your browser could not process that photo.'))),
      'image/jpeg',
      JPEG_QUALITY,
    );
  });
}
