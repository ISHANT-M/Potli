import { describe, expect, it } from 'vitest';
import { TRANSITIONS, canTransition, isActive, STATUS_LABEL, BOOKING_STATUSES } from '../../shared/bookingStatus.ts';
import { PLATFORM_FEE_BPS, computeFee, isWithinOpeningHours, quote } from '../../shared/pricing.ts';
import { normalizePhone, PHONE_PATTERN, BOOKING_CODE_PATTERN } from '../../shared/validation.ts';

const rate = { hourlyRatePaise: 5000, dailyCapPaise: 40000 };
const at = (iso: string) => new Date(iso);

describe('quote', () => {
  it('charges a minimum of one hour', () => {
    const result = quote(rate, 2, at('2030-01-01T04:30:00Z'), at('2030-01-01T04:50:00Z'));
    expect(result.hours).toBe(1);
    expect(result.totalPaise).toBe(10_000);
  });

  it('rounds partial hours up', () => {
    expect(quote(rate, 1, at('2030-01-01T04:00:00Z'), at('2030-01-01T06:01:00Z')).hours).toBe(3);
  });

  it('caps a day at the daily cap per bag', () => {
    const result = quote(rate, 1, at('2030-01-01T04:00:00Z'), at('2030-01-01T16:00:00Z'));
    expect(result.perBagPaise).toBe(40_000);
  });

  it('adds full days and a capped remainder', () => {
    const start = at('2030-01-01T04:00:00Z');
    expect(quote(rate, 1, start, at('2030-01-02T05:00:00Z')).perBagPaise).toBe(40_000 + 5_000);
    expect(quote(rate, 1, start, at('2030-01-03T04:00:00Z')).perBagPaise).toBe(80_000);
  });

  it('multiplies by bags and splits the fee at 15%', () => {
    const result = quote(rate, 3, at('2030-01-01T04:00:00Z'), at('2030-01-01T06:00:00Z'));
    expect(result.totalPaise).toBe(30_000);
    expect(result.feePaise).toBe(4_500);
    expect(result.partnerSharePaise).toBe(25_500);
  });
});

describe('computeFee', () => {
  it('uses 1500 basis points and rounds to whole paise', () => {
    expect(PLATFORM_FEE_BPS).toBe(1500);
    expect(computeFee(10_000)).toBe(1_500);
    expect(computeFee(333)).toBe(50);
    expect(computeFee(0)).toBe(0);
  });
});

describe('isWithinOpeningHours', () => {
  const hours = { openTime: '08:00', closeTime: '22:00', openDays: [0, 1, 2, 3, 4, 5, 6] };

  it('reads times in Asia/Kolkata', () => {
    expect(isWithinOpeningHours(at('2030-01-01T02:30:00Z'), hours)).toBe(true); // 08:00 IST
    expect(isWithinOpeningHours(at('2030-01-01T02:29:00Z'), hours)).toBe(false); // 07:59 IST
    expect(isWithinOpeningHours(at('2030-01-01T16:30:00Z'), hours)).toBe(true); // 22:00 IST
    expect(isWithinOpeningHours(at('2030-01-01T16:31:00Z'), hours)).toBe(false);
  });

  it('respects closed days using the IST calendar day', () => {
    const weekdays = { ...hours, openDays: [1, 2, 3, 4, 5] };
    expect(isWithinOpeningHours(at('2030-01-06T05:00:00Z'), weekdays)).toBe(false); // Sunday
    expect(isWithinOpeningHours(at('2030-01-07T05:00:00Z'), weekdays)).toBe(true); // Monday
    // 20:00 UTC on Sunday is 01:30 IST on Monday, but still outside 08:00-22:00.
    expect(isWithinOpeningHours(at('2030-01-06T20:00:00Z'), weekdays)).toBe(false);
  });
});

describe('booking state machine', () => {
  it('allows the happy path and nothing backwards', () => {
    expect(canTransition('booked', 'dropped')).toBe(true);
    expect(canTransition('dropped', 'stored')).toBe(true);
    expect(canTransition('stored', 'picked_up')).toBe(true);
    expect(canTransition('picked_up', 'completed')).toBe(true);
    expect(canTransition('stored', 'dropped')).toBe(false);
    expect(canTransition('completed', 'cancelled')).toBe(false);
  });

  it('allows cancelling only from booked (traveller/partner) or held states (admin)', () => {
    expect(canTransition('booked', 'cancelled')).toBe(true);
    expect(canTransition('dropped', 'cancelled')).toBe(true);
    expect(canTransition('picked_up', 'cancelled')).toBe(false);
  });

  it('expires only unfulfilled bookings', () => {
    expect(canTransition('booked', 'expired')).toBe(true);
    expect(canTransition('stored', 'expired')).toBe(false);
  });

  it('treats terminal states as inactive and labels every status', () => {
    for (const status of ['completed', 'cancelled', 'expired'] as const) {
      expect(isActive(status)).toBe(false);
      expect(TRANSITIONS[status]).toEqual([]);
    }
    expect(isActive('booked')).toBe(true);
    for (const status of BOOKING_STATUSES) expect(STATUS_LABEL[status]).toBeTruthy();
  });
});

describe('validation helpers', () => {
  it('accepts Indian mobile numbers only', () => {
    expect(PHONE_PATTERN.test('+919876543210')).toBe(true);
    expect(PHONE_PATTERN.test('+915876543210')).toBe(false);
    expect(PHONE_PATTERN.test('9876543210')).toBe(false);
  });

  it('normalises common phone formats', () => {
    expect(normalizePhone('+91 95803 80494')).toBe('+919580380494');
    expect(normalizePhone('9580380494')).toBe('+919580380494');
    expect(normalizePhone('12345')).toBeNull();
  });

  it('matches booking codes', () => {
    expect(BOOKING_CODE_PATTERN.test('PT-ABC234')).toBe(true);
    expect(BOOKING_CODE_PATTERN.test('PT-ABCOI1')).toBe(false);
  });
});
