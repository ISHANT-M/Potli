import { describe, expect, it } from 'vitest';
import { parseQrPayload } from './qr';

describe('parseQrPayload', () => {
  it('reads a Potli QR payload', () => {
    expect(parseQrPayload('POTLI1|PT-ABC234|pickup|123456')).toEqual({ code: 'PT-ABC234', type: 'pickup', otp: '123456' });
  });
  it('rejects anything else', () => {
    for (const text of ['', 'hello', 'POTLI2|PT-ABC234|pickup|123456', 'POTLI1|PT-ABC234|refund|123456', 'POTLI1|PT-ABC234|pickup|12345', 'POTLI1|PT-ABC234|pickup|123456|x', 'https://evil.example']) {
      expect(parseQrPayload(text)).toBeNull();
    }
  });
});
