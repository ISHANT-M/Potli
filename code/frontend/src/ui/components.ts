/** Small shared UI helpers: alerts and status badges. */
import { STATUS_LABEL, STATUS_TONE, type BadgeTone } from '../../../shared/bookingStatus';
import type { BookingStatus, PartnerStatus } from '../../../shared/types';
import { html, type SafeHtml } from '../lib/html';

export function alert(tone: 'info' | 'success' | 'warning' | 'danger', content: unknown): SafeHtml {
  const role = tone === 'danger' || tone === 'warning' ? 'alert' : 'status';
  return html`<div class="alert alert-${tone}" role="${role}">${content}</div>`;
}

const BADGE_TONE_CLASS: Record<BadgeTone, string> = {
  neutral: 'badge-neutral',
  info: 'badge-info',
  success: 'badge-success',
  warning: 'badge-warning',
  danger: 'badge-danger',
};

export function badge(label: string, tone: BadgeTone): SafeHtml {
  return html`<span class="badge ${BADGE_TONE_CLASS[tone]}">${label}</span>`;
}

/** One helper for booking status colours across every portal. */
export function statusBadge(status: BookingStatus): SafeHtml {
  return badge(STATUS_LABEL[status], STATUS_TONE[status]);
}

const PARTNER_LABEL: Record<PartnerStatus, [string, BadgeTone]> = {
  pending: ['Pending review', 'warning'],
  approved: ['Approved', 'success'],
  rejected: ['Rejected', 'danger'],
  suspended: ['Suspended', 'danger'],
};

export function partnerStatusBadge(status: PartnerStatus): SafeHtml {
  const [label, tone] = PARTNER_LABEL[status];
  return badge(label, tone);
}

