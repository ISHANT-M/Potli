import type { HandoffType } from '../../../../shared/types';
import { OTP_PATTERN } from '../../../../shared/validation';

/** `POTLI1|code|type|otp`; anything else is not ours. */
export function parseQrPayload(text: string): { code: string; type: HandoffType; otp: string } | null {
  const [tag, code, type, otp, ...rest] = text.trim().split('|');
  if (tag !== 'POTLI1' || rest.length > 0 || !code || !otp) return null;
  if ((type !== 'drop_off' && type !== 'pickup') || !OTP_PATTERN.test(otp)) return null;
  return { code, type, otp };
}
