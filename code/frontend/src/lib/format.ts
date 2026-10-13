/** Display formatting: rupees from integer paise, and Asia/Kolkata dates and times. */

const TIME_ZONE = 'Asia/Kolkata';

export function formatINR(paise: number): string {
  const rupees = paise / 100;
  const hasPaise = paise % 100 !== 0;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: hasPaise ? 2 : 0,
    maximumFractionDigits: hasPaise ? 2 : 0,
  }).format(rupees);
}

const dateFormat = new Intl.DateTimeFormat('en-IN', { timeZone: TIME_ZONE, day: 'numeric', month: 'short', year: 'numeric' });
const timeFormat = new Intl.DateTimeFormat('en-IN', { timeZone: TIME_ZONE, hour: 'numeric', minute: '2-digit', hour12: true });
const dateTimeFormat = new Intl.DateTimeFormat('en-IN', {
  timeZone: TIME_ZONE,
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

const toDate = (value: string | Date): Date => (value instanceof Date ? value : new Date(value));

export const formatDate = (value: string | Date): string => dateFormat.format(toDate(value));
export const formatTime = (value: string | Date): string => timeFormat.format(toDate(value)).replace(/\s/g, ' ').toLowerCase();
export const formatDateTime = (value: string | Date): string =>
  dateTimeFormat.format(toDate(value)).replace(/\s/g, ' ').replace(/\b(AM|PM)\b/, (m) => m.toLowerCase());

/** "2 h 30 min", "45 min", "1 day 3 h". Input is milliseconds. */
export function formatDuration(ms: number): string {
  const totalMinutes = Math.max(0, Math.round(ms / 60_000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];
  if (days) parts.push(`${days} ${days === 1 ? 'day' : 'days'}`);
  if (hours) parts.push(`${hours} h`);
  if (minutes && days === 0) parts.push(`${minutes} min`);
  return parts.length > 0 ? parts.join(' ') : '0 min';
}

/** "in 2 hours", "5 minutes ago", "just now". */
export function relativeTime(value: string | Date, now: Date = new Date()): string {
  const diffMs = toDate(value).getTime() - now.getTime();
  const abs = Math.abs(diffMs);
  if (abs < 45_000) return 'just now';
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['day', 86_400_000],
    ['hour', 3_600_000],
    ['minute', 60_000],
  ];
  const formatter = new Intl.RelativeTimeFormat('en-IN', { numeric: 'auto' });
  for (const [unit, size] of units) {
    if (abs >= size || unit === 'minute') return formatter.format(Math.round(diffMs / size), unit);
  }
  return 'just now';
}

/** "2 Mar 2027, 10:00 am to 2:00 pm" style range for a booking slot. */
export function formatSlot(start: string | Date, end: string | Date): string {
  const sameDay = formatDate(start) === formatDate(end);
  return sameDay
    ? `${formatDate(start)}, ${formatTime(start)} to ${formatTime(end)}`
    : `${formatDateTime(start)} to ${formatDateTime(end)}`;
}

/** "08:00" to "8:00 am" for opening hours. */
export function formatClock(hhmm: string): string {
  const [hours = '0', minutes = '00'] = hhmm.split(':');
  const h = Number(hours);
  const suffix = h >= 12 ? 'pm' : 'am';
  return `${h % 12 === 0 ? 12 : h % 12}:${minutes} ${suffix}`;
}
