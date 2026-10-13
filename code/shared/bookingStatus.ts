/** Booking lifecycle: statuses, allowed transitions, labels and badge tones. */
import type { BookingStatus } from './types.ts';

export const BOOKING_STATUSES = [
  'pending_payment',
  'booked',
  'dropped',
  'stored',
  'picked_up',
  'completed',
  'cancelled',
  'expired',
] as const satisfies readonly BookingStatus[];

/**
 * Which statuses each status may move to (state diagram, 02-CONTRACTS section 2).
 * Deviations from the diagram: cash-on-pickup creates bookings directly in `booked`
 * (nothing to capture up front), and admins may cancel held bookings (dropped/stored)
 * for disputes.
 */
export const TRANSITIONS: Record<BookingStatus, readonly BookingStatus[]> = {
  pending_payment: ['booked', 'cancelled', 'expired'],
  booked: ['dropped', 'cancelled', 'expired'],
  dropped: ['stored', 'cancelled'],
  stored: ['picked_up', 'cancelled'],
  picked_up: ['completed'],
  completed: [],
  cancelled: [],
  expired: [],
};

export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Statuses whose bags still occupy a shelf (counted against capacity). */
export const CAPACITY_STATUSES = ['pending_payment', 'booked', 'dropped', 'stored'] as const satisfies readonly BookingStatus[];

/** True while the booking can still change; terminal states are final. */
export function isActive(status: BookingStatus): boolean {
  return TRANSITIONS[status].length > 0;
}

export const STATUS_LABEL: Record<BookingStatus, string> = {
  pending_payment: 'Awaiting payment',
  booked: 'Booked',
  dropped: 'Dropped off',
  stored: 'Stored',
  picked_up: 'Picked up',
  completed: 'Completed',
  cancelled: 'Cancelled',
  expired: 'Expired',
};

export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export const STATUS_TONE: Record<BookingStatus, BadgeTone> = {
  pending_payment: 'warning',
  booked: 'info',
  dropped: 'info',
  stored: 'info',
  picked_up: 'warning',
  completed: 'success',
  cancelled: 'danger',
  expired: 'neutral',
};
