/** Pure pricing and opening-hours rules; the server always recomputes what the client shows. */

export const PLATFORM_FEE_BPS = 1500;
export const MAX_BAGS = 10;
export const MAX_DAYS = 7;
export const MAX_ADVANCE_DAYS = 30;

const HOUR_MS = 3_600_000;
const IST_OFFSET_MS = 330 * 60_000;

export interface RateCard {
  hourlyRatePaise: number;
  dailyCapPaise: number;
}

export interface OpeningHours {
  openTime: string;
  closeTime: string;
  openDays: readonly number[];
}

export interface Quote {
  hours: number;
  perBagPaise: number;
  totalPaise: number;
  feePaise: number;
  partnerSharePaise: number;
}

export function billableHours(start: Date, end: Date): number {
  return Math.max(1, Math.ceil((end.getTime() - start.getTime()) / HOUR_MS));
}

export function computeFee(totalPaise: number): number {
  return Math.round((totalPaise * PLATFORM_FEE_BPS) / 10_000);
}

export function quote(rate: RateCard, bags: number, start: Date, end: Date): Quote {
  const hours = billableHours(start, end);
  const fullDays = Math.floor(hours / 24);
  const remainder = hours % 24;
  const perBagPaise = fullDays * rate.dailyCapPaise + Math.min(remainder * rate.hourlyRatePaise, rate.dailyCapPaise);
  const totalPaise = bags * perBagPaise;
  const feePaise = computeFee(totalPaise);
  return { hours, perBagPaise, totalPaise, feePaise, partnerSharePaise: totalPaise - feePaise };
}

/** IST is a fixed +05:30 offset with no DST, so shifting the clock is exact. */
export function toIst(date: Date): { day: number; minutes: number } {
  const shifted = new Date(date.getTime() + IST_OFFSET_MS);
  return { day: shifted.getUTCDay(), minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes() };
}

export function parseClock(value: string): number {
  const [hours = '0', minutes = '0'] = value.split(':');
  return Number(hours) * 60 + Number(minutes);
}

/** True when the moment falls on an open day and within [open, close] in Asia/Kolkata. */
export function isWithinOpeningHours(moment: Date, hours: OpeningHours): boolean {
  const { day, minutes } = toIst(moment);
  if (!hours.openDays.includes(day)) return false;
  return minutes >= parseClock(hours.openTime) && minutes <= parseClock(hours.closeTime);
}
