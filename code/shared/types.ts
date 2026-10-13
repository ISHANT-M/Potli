/** DTOs and unions exchanged between the API and the frontends (02-CONTRACTS section 8). */

export type Role = 'traveler' | 'storage_partner' | 'admin';
export type PartnerStatus = 'pending' | 'approved' | 'rejected' | 'suspended';
export type ListingStatus = 'active' | 'paused' | 'flagged';
export type BookingStatus =
  | 'pending_payment'
  | 'booked'
  | 'dropped'
  | 'stored'
  | 'picked_up'
  | 'completed'
  | 'cancelled'
  | 'expired';
export type PaymentMethod = 'cod' | 'upi' | 'card';
export type PaymentStatus = 'pending' | 'captured' | 'refunded' | 'payout_settled' | 'failed';
export type HandoffType = 'drop_off' | 'pickup';
export type HandoffMethod = 'qr' | 'otp';
export type DisputeStatus = 'open' | 'resolved' | 'rejected';

export interface ApiError {
  error: { code: string; message: string; fields?: Record<string, string>; detail?: string };
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface Me {
  id: string;
  email: string;
  fullName: string;
  phone: string;
  role: Role;
  emailVerified: boolean;
  partner: null | {
    status: PartnerStatus;
    businessName: string;
    businessType: string;
    phone: string;
    address: string;
    city: string;
    rejectionReason: string | null;
  };
}

export interface ListingSummary {
  id: string;
  name: string;
  area: string;
  city: string;
  address: string;
  latitude: number;
  longitude: number;
  hourlyRatePaise: number;
  dailyCapPaise: number;
  openTime: string;
  closeTime: string;
  openDays: number[];
  businessName: string;
  coverUrl: string | null;
  ratingAverage: number | null;
  ratingCount: number;
  distanceKm: number | null;
  /** Bags free for the requested window, when one was given. */
  available: number | null;
}

export interface ListingDetail extends ListingSummary {
  description: string;
  capacity: number;
}

export interface HandoffCode {
  type: HandoffType;
  otp: string;
  qrPayload: string;
}

export interface Booking {
  id: string;
  code: string;
  status: BookingStatus;
  bagCount: number;
  slotStart: string;
  slotEnd: string;
  quotedPaise: number;
  finalPaise: number | null;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  listing: {
    id: string;
    name: string;
    address: string;
    area: string;
    city: string;
    latitude: number;
    longitude: number;
    openTime: string;
    closeTime: string;
    businessName: string;
    phone?: string;
  };
  timeline: {
    bookedAt: string | null;
    droppedAt: string | null;
    storedAt: string | null;
    pickedUpAt: string | null;
    completedAt: string | null;
    cancelledAt: string | null;
  };
  cancelReason: string | null;
  canCancel: boolean;
  canRate: boolean;
  /** Traveller only, per the visibility rules in 02-CONTRACTS section 5. */
  handoffCode: HandoffCode | null;
  dropOffPhotoUrls: string[];
  rating: { score: number; comment: string } | null;
}

export interface PartnerBooking extends Omit<Booking, 'handoffCode' | 'canRate' | 'rating'> {
  traveler: { fullName: string; phone: string };
  overstayPaise: number;
  feePaise: number | null;
  partnerSharePaise: number | null;
  isOverdue: boolean;
}

export interface PartnerListing extends ListingDetail {
  status: ListingStatus;
  flagReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminBooking extends Omit<PartnerBooking, 'traveler'> {
  traveler: { id: string; fullName: string; phone: string; email: string };
  partner: { id: string; fullName: string; businessName: string };
  searchStartedAt: string | null;
}

export interface Settlement {
  id: string;
  partnerId: string;
  businessName: string;
  amountPaise: number;
  paymentCount: number;
  reference: string;
  note: string;
  recordedBy: { id: string; fullName: string };
  createdAt: string;
}

export interface AuditEntry {
  id: string;
  actor: { id: string; fullName: string; role: Role } | null;
  action: string;
  entity: string;
  entityId: string;
  metadata: Record<string, unknown>;
  ip: string | null;
  createdAt: string;
}
