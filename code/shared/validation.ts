/** Shared regexes and limits so the browser and the API validate identically. */

export const PHONE_PATTERN = /^\+91[6-9]\d{9}$/;
export const NAME_MIN = 2;
export const NAME_MAX = 80;
export const PASSWORD_MIN = 8;
export const BOOKING_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const BOOKING_CODE_PATTERN = /^PT-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;
export const OTP_PATTERN = /^\d{6}$/;
export const BUSINESS_TYPES = ['shop', 'hotel', 'cafe', 'other'] as const;

/** Accept "+91 95803 80494", "9580380494" or "+919580380494" and return E.164, or null. */
export function normalizePhone(input: string): string | null {
  const digits = input.replace(/[\s-]/g, '');
  const candidate = /^\d{10}$/.test(digits) ? `+91${digits}` : digits;
  return PHONE_PATTERN.test(candidate) ? candidate : null;
}

export function isValidName(value: string): boolean {
  const length = value.trim().length;
  return length >= NAME_MIN && length <= NAME_MAX;
}
