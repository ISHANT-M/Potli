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
(payments/payouts/refunds, ratings, duplicate-listing checks) are included
because they are part of the approved scope, and are flagged as such in the
dictionary. Level 0 follows the approved Mermaid source (`assets/dfd-level-0.mmd`),
which scopes the context to four external entities (no separate notification
service); Levels 1–2 are balanced to match.

## Conventions

- Rectangles: external entities. Circles: numbered processes. Labeled
  rectangles (D1–D7): data stores. Every arrow is a named data flow
  (no control flow).
- Balancing is preserved: each Level 0 flow reappears at Level 1, and every
  Level 1 boundary flow of processes 3.0/4.0 reappears at Level 2, where
  sibling Level-1 processes (2.0, 5.0, 6.0) are shown as external entities.
- Editable sources: `assets/dfd-level-0.mmd` (Mermaid, rendered with the
  Mermaid CLI) for Level 0; `assets/dfd-level-{1,2}.drawio` (draw.io) for
  Levels 1–2. The draw.io SVGs embed the same source, matching the existing
  project assets. PNGs are exported at 2x for print.

## Level 0 — Context diagram (`assets/dfd-level-0.*`)

POTLI as a single process (0) and the four external entities it exchanges
data with: Traveler, Storage Partner, Administrator, and the external Payment
Gateway (UPI). The traveler sends registration, search, and booking details;
the system returns storage options, booking confirmations, and status. The
partner sends business details, availability, and handoff updates, and
receives booking details, verification, and earnings information. The
administrator exchanges management/approval details for reports, user
information, and dispute handling. Payments and refunds flow through the
payment gateway.

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
  escrow-style hold until pickup, partner payout, refunds, and platform-fee
  accounting; writes D6 Transactions.
- **6.0 Administration & Monitoring** — partner approval, coverage/utilization
  analytics, fee audit, dispute handling; reads D2/D3/D4/D6, writes
  D7 Ratings & Reviews.

## Level 2 — Booking and luggage handoff (`assets/dfd-level-2.*`)

Decomposes 3.0 and 4.0 into seven subprocesses following the booking
lifecycle (Booked → Dropped → Stored → Picked up, per the proposal):

- **3.1 Reserve Slot** — checks D2 availability and D1 identity, creates the
  D3 booking record.
- **3.2 Generate QR/OTP** — creates the booking code, stores it on D3.
- **3.3 Confirm Booking** — finalizes D3 and notifies the traveler and partner.
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
| G / PG | Payment Gateway (UPI) | External UPI payment provider for collection, settlement, payouts, and refunds (planned) | Proposal §Solution |

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
| D6 | Transactions | Payments, escrow holds, payouts, refunds, platform fees | 5.0 |
| D7 | Ratings & Reviews | Post-pickup 1–5 traveler ratings of partners | 6.0 (from T) |

### Key data flows (Level 0 / Level 1 boundary)

| Flow (Level 0 grouping) | Level 1 refinement (From → To) | Description |
| --- | --- | --- |
| Registration, search and booking details (T → S) | traveler registration (T → 1.0); search query (T → 2.0); booking request & codes (T → 3.0); handoff codes & photos (T → 4.0); payment (T → 5.0); rating (T → 6.0) | Traveler onboarding, location query, slot request, QR/OTP presentation, UPI payment, post-pickup rating |
| Storage options, booking confirmation and status (S → T) | search results (2.0 → T); confirmation + QR/OTP (3.0 → T); handoff confirmation & luggage photo (4.0 → T) | Matching listings, confirmed booking with code, drop-off/pickup proof |
| Business details, availability and handoff updates (P → S) | registration & listing (P → 1.0); handoff validation & photos (P → 4.0) | Business profile, capacity, pricing, hours; scan/OTP confirmation plus photos |
| Booking details, verification and earnings information (S → P) | booking & handoff notices (4.0 → P); payout (5.0 → P) | Booking alerts and earnings payout |
| Management and approval details (A → S) | approval / monitoring queries (A → 6.0) | Partner approval, coverage and quality monitoring |
| Reports, user details and dispute information (S → A) | analytics, approvals, fee audit (6.0 → A) | Utilization and revenue reports, fee audit, dispute handling |
| Payment and refund requests (S → G) | payment authorization, settlement, payout & refund instruction (5.0 → PG) | UPI collection, escrow settlement, partner payout, refunds |
| Payment and refund status (G → S) | payment and refund status (PG → 5.0) | Gateway confirmation of payments and refunds |
