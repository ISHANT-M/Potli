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

Consequently, everything shown in these DFDs — registration, search, booking,
QR/OTP handoff, payments/payouts/refunds, partner verification, administration —
is the **planned/designed system**, grounded in the sources above. No
functionality has been invented: every process, entity, store, and flow below
traces to the README capabilities table, the proposal workflow, or the
use-case diagram. Features the proposal marks as later deliverables
(payments/payouts/refunds, duplicate-listing checks) are included because
they are part of the approved scope, and are flagged as such in the
dictionary. Post-pickup ratings and the photographic handoff proof (proposal
and use-case scope) sit outside the named DFD flows: ratings have no
Level 1 flow yet, and photos travel inside the drop-off record (P34 → D3).
All three levels follow the approved Mermaid sources
(`assets/dfd-level-{0,1,2}.mmd`).

## Conventions

- Rectangles: external entities. Circles (`(( ))`): numbered processes.
  Cylinders (`[( )]`): data stores (D1–D4). Every arrow is a named data flow
  (no control flow); `<-->` marks a two-way read/write flow with a store.
- Balancing is preserved: each Level 0 flow reappears at Level 1, and every
  Level 1 boundary flow of process 3.0 reappears at Level 2. In Level 2 the
  sibling process 4.0 (PAY) is shown as a circle since it is Level 1's P4.
- Editable sources: `assets/dfd-level-{0,1,2}.mmd` (Mermaid, rendered with
  the Mermaid CLI to SVG and 2x PNG). One deliberate addition to the Level 1
  source keeps balancing: `P4 --> Payout and earnings information --> P`,
  realizing Level 0's S → P "earnings information" (no payout path existed).
  Level 2 reads/updates D2 (availability) as a refinement of the booking
  flow; Level 1 shows D2 under P2/P5.

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

Process 0 is decomposed into five numbered processes and four data stores:

- **1.0 Manage Accounts (P1)** — traveler registration/login and account
  status; reads/writes D1 User & Partner Data.
- **2.0 Manage Storage Listings (P2)** — partner business details and
  availability intake, traveler search over D2 Storage Listings.
- **3.0 Manage Bookings & Handoffs (P3)** — booking and handoff details,
  confirmations, and status; reads/writes D3 Booking Records; hands payment
  details to P4.
- **4.0 Process Payments (P4)** — UPI collection, refunds, and partner
  payouts via the payment gateway; reads/writes D4 Payment Records.
- **5.0 Administer Platform (P5)** — partner approval, reports, and dispute
  handling; reads D1–D4.

## Level 2 — Booking and handoff detail (`assets/dfd-level-2.*`)

Decomposes Level 1 process 3.0 into five subprocesses following the booking
lifecycle (Booked → Dropped → Stored → Picked up, per the proposal). The
sibling payment process appears as PAY (Level 1's 4.0); D2 is read/updated
for availability as a refinement of the booking flow:

- **3.1 Validate Booking Request (P31)** — checks the traveler request
  against D2 availability and pricing, passes validated details to P32.
- **3.2 Create Booking (P32)** — writes the D3 booking record, updates D2
  availability, exchanges payment details/status with PAY, and confirms to
  traveler and partner.
- **3.3 Verify Handoff (P33)** — matches traveler handoff details against
  D3, passes verified handoff details to P34.
- **3.4 Record Drop-off (P34)** — records the partner-confirmed drop-off and
  booking status in D3 (including the photographic handoff proof), confirms
  drop-off status to the traveler.
- **3.5 Complete Pickup (P35)** — verifies traveler/partner pickup details
  against D3, writes the completed booking and pickup record, restores D2
  availability, and confirms completion to traveler and partner.

## Data dictionary

### External entities

| ID | Name | Description | Source |
| --- | --- | --- | --- |
| T | Traveler | Person storing luggage; registers, searches, books, verifies handoffs | README, use case |
| P | Storage Partner (Shop / Hotel) | Verified business offering space; lists availability, confirms handoffs, receives payouts | README, use case |
| A | Administrator | Platform operator; approves partners, receives reports, handles disputes | README, use case |
| G | Payment Gateway (UPI) | External UPI provider for collection, refunds, and settlement (planned) | Proposal §Solution |

### Level 1 processes

| ID | Name | Description | Status |
| --- | --- | --- | --- |
| 1.0 (P1) | Manage Accounts | Traveler registration/login, account status; reads/writes D1 | Planned (static pages only) |
| 2.0 (P2) | Manage Storage Listings | Partner business details/availability intake; traveler search and storage options; reads/writes D2 | Planned |
| 3.0 (P3) | Manage Bookings & Handoffs | Booking/handoff details, confirmations, status; reads/writes D3; decomposed in Level 2 | Planned |
| 4.0 (P4) | Process Payments | UPI collection, refunds, partner payouts via gateway; reads/writes D4 | Planned (later deliverable) |
| 5.0 (P5) | Administer Platform | Partner approval, reports, dispute handling; reads D1–D4 | Planned (later deliverable) |

### Level 2 subprocesses (decompose 3.0)

| ID | Name | Description |
| --- | --- | --- |
| 3.1 (P31) | Validate Booking Request | Traveler request checked against D2 availability/pricing |
| 3.2 (P32) | Create Booking | D3 record, D2 update, payment exchange with 4.0, confirmations |
| 3.3 (P33) | Verify Handoff | Traveler handoff details matched against D3 |
| 3.4 (P34) | Record Drop-off | Partner-confirmed drop-off and status in D3; status to traveler |
| 3.5 (P35) | Complete Pickup | Pickup verified against D3; completion record, D2 restore, status out |

### Data stores

| ID | Name | Contents | Written by |
| --- | --- | --- | --- |
| D1 | User & Partner Data | Traveler/partner/admin accounts and credentials | P1, read by P5 |
| D2 | Storage Listings | Business profile, capacity, pricing, hours, availability | P2; updated by P31/P32/P35 (Level 2 refinement); read by P5 |
| D3 | Booking Records | Booking ID, traveler, partner, slot, QR/OTP, status (Booked/Dropped/Stored/Picked up), drop-off/pickup records | P3 (P32/P34/P35); read by P5 |
| D4 | Payment Records | Payments, refunds, payouts, transaction data | P4; read by P5 |

### Key data flows (Level 0 → Level 1)

| Level 0 flow | Level 1 flows (From → To) |
| --- | --- |
| Registration, search and booking details (T → S) | Registration and login details (T → P1); Search criteria (T → P2); Booking and handoff details (T → P3) |
| Storage options, booking confirmation and status (S → T) | Account status (P1 → T); Available storage options (P2 → T); Booking confirmation and status (P3 → T) |
| Business details, availability and handoff updates (P → S) | Business details and availability (P → P2); Drop-off and pickup updates (P → P3) |
| Booking details, verification and earnings information (S → P) | Listing status (P2 → P); Booking and verification details (P3 → P); Payout and earnings information (P4 → P, added to preserve this flow) |
| Management and approval details (A → S) | Management and approval details (A → P5) |
| Reports, user details and dispute information (S → A) | Reports and dispute information (P5 → A; user data via P5 ↔ D1) |
| Payment and refund requests (S → G) | Payment and refund requests (P4 → G) |
| Payment and refund status (G → S) | Payment and refund status (G → P4) |

### Key data flows (Level 1 P3 → Level 2)

| Level 1 P3 flow | Level 2 flows |
| --- | --- |
| Booking and handoff details (T → P3) | Booking request (T → P31); Handoff verification details (T → P33); Pickup verification details (T → P35) |
| Booking confirmation and status (P3 → T) | Booking confirmation and verification details (P32 → T); Drop-off status (P34 → T); Booking completion status (P35 → T) |
| Booking and verification details (P3 → P) | Booking and verification details (P32 → P); Booking completion status (P35 → P) |
| Drop-off and pickup updates (P → P3) | Drop-off confirmation (P → P34); Pickup confirmation (P → P35) |
| Payment details (P3 → P4) | Payment details (P32 → PAY) |
| Payment status (P4 → P3) | Payment status (PAY → P32) |
| Booking data (P3 ↔ D3) | Booking record (P32 → D3); verification queries and data (P33/P35 ↔ D3); drop-off and completion records (P34/P35 → D3) |
| (refinement) availability | Availability query and pricing data (P31 ↔ D2); availability updates (P32/P35 → D2) |
