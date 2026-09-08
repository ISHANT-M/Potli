# POTLI Data Flow Diagrams (Level 0 – Level 2)

This document explains the Data Flow Diagrams for the POTLI luggage-storage
network and provides the data dictionary. The diagrams model the **designed
system** described in the project `README.md`, `project-proposal/main.tex`,
and the approved use-case and activity diagrams.

## Implemented vs planned

POTLI is in the **planning and design phase**. The only implemented code is a
static frontend shell (`code/frontend`): landing, traveler login, admin login,
and partner sign-up pages with no backend. The backend (`code/backend`) and
database (`code/db`) directories are reserved placeholders.

Consequently, everything shown in these DFDs — search, booking, QR/OTP
handoff, payments and payouts, partner verification, ratings, notifications —
is the **planned/designed system**, grounded in the sources above. No
functionality has been invented: every process, entity, store, and flow below
traces to the README capabilities table, the proposal workflow, or the
use-case diagram. Features the proposal marks as later deliverables
(payments/payouts, ratings, SMS/WhatsApp notifications, duplicate-listing
checks) are included because they are part of the approved scope, and are
flagged as such in the dictionary.

## Conventions

- Rectangles: external entities. Circles: numbered processes. Labeled
  rectangles (D1–D7): data stores. Every arrow is a named data flow
  (no control flow).
- Balancing is preserved: each Level 0 flow reappears at Level 1, and every
  Level 1 boundary flow of processes 3.0/4.0 reappears at Level 2, where
  sibling Level-1 processes (2.0, 5.0, 6.0) and the notification service are
  shown as external entities.
- Editable sources: `assets/dfd-level-{0,1,2}.drawio` (draw.io). The SVGs
  embed the same source, matching the existing project assets. PNGs are
  exported at 2x for print.

## Level 0 — Context diagram (`assets/dfd-level-0.*`)

POTLI as a single process (0) and the five external entities it exchanges
data with: Customer/Traveler, Storage Partner, Admin/Super User, the external
UPI Payment Gateway, and the external SMS/WhatsApp Notification Service.
The traveler searches, books, presents QR/OTP codes, rates, and pays; the
system returns results, confirmations, handoff proofs, and photos. Partners
register, validate handoffs, and receive payouts. Admins approve partners and
receive analytics and fee audits.

## Level 1 — System decomposition (`assets/dfd-level-1.*`)

Process 0 is decomposed into six numbered processes and seven data stores:

- **1.0 Account & Partner Onboarding** — traveler/partner registration and
  login; writes D1 Users.
- **2.0 Discovery & Search** — geo/city search over D2 Partner Listings &
  Availability.
- **3.0 Booking Management** — slot reservation, QR/OTP generation, and
  confirmation; writes D3 Bookings.
- **4.0 Luggage Handoff Management** — QR/OTP check-in validation, drop-off
  recording with photographs, pickup matching; writes D4 Handoff Logs and
  D5 Photographs.
- **5.0 Payment & Payout** — UPI collection via the payment gateway,
  escrow-style hold until pickup, partner payout, platform-fee accounting;
  writes D6 Transactions.
- **6.0 Administration & Monitoring** — partner approval, coverage/utilization
  analytics, fee audit, dispute handling; reads D2/D3/D4/D6, writes
  D7 Ratings & Reviews.

## Level 2 — Booking and luggage handoff (`assets/dfd-level-2.*`)

Decomposes 3.0 and 4.0 into seven subprocesses following the booking
lifecycle (Booked → Dropped → Stored → Picked up, per the proposal):

- **3.1 Reserve Slot** — checks D2 availability and D1 identity, creates the
  D3 booking record.
- **3.2 Generate QR/OTP** — creates the booking code, stores it on D3.
- **3.3 Confirm Booking** — finalizes D3, notifies traveler, partner, and the
  notification service.
- **4.1 Validate Check-in** — partner scans QR/enters OTP, writes the D4
  check-in record.
- **4.2 Record Drop-off** — tags luggage to the booking ID, stores D4 record
  and D5 photographs.
- **4.3 Validate Pickup** — matches retrieval code and luggage, writes the D4
  pickup record.
- **4.4 Complete Booking** — marks D3 complete, confirms to traveler/partner,
  triggers 5.0 settlement and reports stats to 6.0.

## Data dictionary

### External entities

| ID | Name | Description | Source |
| --- | --- | --- | --- |
| T | Customer / Traveler | Person storing luggage; searches, books, presents codes, pays, rates | README, use case |
| P | Storage Partner (Shop / Hotel) | Verified business offering space; validates handoffs, receives payouts | README, use case |
| A | Admin / Super User | Platform operator; approves partners, monitors activity and fees | README, use case |
| PG | Payment Gateway (UPI) | External UPI payment provider for collection, settlement, payouts (planned) | Proposal §Solution |
| NS | Notification Service (SMS/WhatsApp) | External channel for booking/handoff notifications (planned) | Proposal §Solution |

### Level 1 processes

| ID | Name | Description | Status |
| --- | --- | --- | --- |
| 1.0 | Account & Partner Onboarding | Registration/login for travelers and partners; partner listing intake | Planned (static pages only) |
| 2.0 | Discovery & Search | City/map search, availability, price/hours comparison | Planned |
| 3.0 | Booking Management | Reservation, QR/OTP generation, confirmation | Planned |
| 4.0 | Luggage Handoff Management | Check-in/drop-off/pickup verification with photo records | Planned |
| 5.0 | Payment & Payout | UPI payment, escrow hold, payout, 15% platform dues | Planned (later deliverable) |
| 6.0 | Administration & Monitoring | Partner approval, analytics, fee audit, disputes | Planned (later deliverable) |

### Data stores

| ID | Name | Contents | Written by |
| --- | --- | --- | --- |
| D1 | Users | Traveler/partner/admin accounts and credentials | 1.0 |
| D2 | Partner Listings & Availability | Business profile, capacity, pricing, hours, verification status | 1.0, 6.0 |
| D3 | Bookings | Booking ID, traveler, partner, slot, QR/OTP, status (Booked/Dropped/Stored/Picked up) | 3.x, 4.4 |
| D4 | Handoff Logs | Check-in/drop-off/pickup records with timestamps (BFT measurement) | 4.x |
| D5 | Photographs | Drop-off/pickup luggage photos | 4.2 |
| D6 | Transactions | Payments, escrow holds, payouts, platform fees | 5.0 |
| D7 | Ratings & Reviews | Post-pickup 1–5 traveler ratings of partners | 6.0 (from T) |

### Key data flows (Level 0 / Level 1 boundary)

| Flow | From → To | Description |
| --- | --- | --- |
| search query / results & availability | T ↔ System (2.0) | Location query; matching listings with price/hours |
| booking request / confirmation + QR/OTP | T ↔ System (3.0) | Slot request; confirmed booking with handoff code |
| check-in / retrieval code | T → System (4.0) | QR/OTP presented at drop-off and pickup |
| handoff confirmation & luggage photo | System (4.0) → T | Proof of drop-off/pickup with stored-luggage photo |
| rating / payment | T → System (6.0 / 5.0) | Post-pickup rating; UPI payment |
| registration & listing | P → System (1.0) | Business profile, capacity, pricing, hours |
| handoff validation & photos | P → System (4.0) | Scan/OTP confirmation plus luggage photographs |
| booking & handoff notices / payout | System (4.0 / 5.0) → P | Booking alerts; earnings payout |
| approval & monitoring queries / decisions, analytics, fee audit | A ↔ System (6.0) | Partner approval; coverage, utilization, revenue reports |
| payment authorization, settlement, payout instruction / confirmation | System (5.0) ↔ PG | UPI collection and partner settlement |
| notification request / delivery status | System (3.0/4.0) ↔ NS | Booking and handoff alerts |
