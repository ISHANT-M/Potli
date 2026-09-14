# POTLI UML Diagrams (Sequence, Class, Collaboration, State)

This document explains the behavioural and structural UML diagrams that
complement the [use-case diagram](../assets/use-case-diagram.svg), the
[activity diagram](../assets/activity-diagram.svg), and the
[data flow diagrams](data-flow-diagrams.md). Together they model the
**designed system** described in the project `README.md` and
`project-proposal/main.tex`.

## Implemented vs planned

POTLI is in the **planning and design phase**. The only implemented code is
the static frontend shell, a versioned auth API (`/api/v1/auth/login`,
`/api/v1/auth/me`), and a `users` / `partner_profiles` schema (see
`code/`). Everything else shown below — search, booking, QR/OTP handoff,
payments, payouts, ratings, admin oversight — is the **planned/designed
system**, grounded in the README capabilities table, the proposal's core
workflow, and the data flow diagrams' numbered processes (P1–P5, P31–P35)
and data stores (D1–D4). Every class, message, and state below traces to one
of those sources; nothing is invented beyond the level of detail needed to
draw a complete diagram.

## Conventions

- Editable sources: `assets/{sequence,class,collaboration,state}-diagram.mmd`
  (Mermaid), rendered with the Mermaid CLI (`mmdc`) to SVG and 2x PNG, the
  same pipeline used for the DFDs.
- Process references such as `(P31)` or `(P4)` point at the matching process
  in [Data Flow Diagrams](data-flow-diagrams.md), so the same operation can
  be traced across every diagram in the project.

## Sequence diagram — booking and handoff workflow (`assets/sequence-diagram.*`)

Shows the primary designed interaction end to end: a traveler searching for
storage, confirming a booking, the drop-off handoff, and the pickup and
payout settlement. Participants are the Traveler and Storage Partner
(actors), the Web App (frontend), the Backend API, the Database, and the
Payment Gateway (UPI) — mirroring the DFD Level 0 external entities and the
Level 1/2 processes.

- **Discovery & booking** (`P2`, `P31`, `P32`): search, availability
  validation, payment capture, booking record creation, and QR/OTP
  generation.
- **Drop-off handoff** (`P33`, `P34`): the partner scans the check-in
  code, the API matches it against the booking record, and the drop-off
  (with photo) is recorded.
- **Pickup & settlement** (`P35`, `P4`): the partner verifies the retrieval
  code, the booking is completed, availability is restored, and the
  partner payout is released through the payment gateway. The traveler is
  then prompted for a post-pickup rating.

## Class diagram — domain model (`assets/class-diagram.*`)

Models the core objects behind the data stores D1–D4 and the capabilities
table in the README. `User` is an abstract base (matching the single
`users` table with a `role` enum in `code/db/schema.sql`) specialised by
`Traveler`, `StoragePartner`, and `Administrator`. Key relationships:

| Relationship | Meaning |
| --- | --- |
| `User <|-- Traveler / StoragePartner / Administrator` | Role specialisation (generalisation), matching `users.role` |
| `StoragePartner *-- PartnerProfile` | Business details, matching `partner_profiles` |
| `StoragePartner o-- StorageListing` | A partner manages zero or more listings (D2) |
| `Traveler --> Booking` | A traveler makes zero or more bookings (D3) |
| `Booking *-- HandoffRecord` | Drop-off and pickup proof, including the photograph (D3) |
| `Booking *-- Payment` | Payment, platform fee, and payout (D4) |
| `Booking o-- Rating` | Optional post-pickup rating (README: "Rate the experience") |
| `Administrator ..> StorageListing / Booking` | Verification and audit, read-only dependency (P5) |

`BookingStatus`, `PaymentStatus`, and `HandoffType` are enumerations that
back the state diagram below and the DFD's booking status field.

## Collaboration diagram — create booking (`assets/collaboration-diagram.*`)

The classic UML communication-diagram view of the same "confirm booking"
scenario covered by the sequence diagram's first phase, drawn as objects
(`:Traveler`, `W:WebApp`, `API:BookingService`, `D2:ListingStore`,
`D3:BookingStore`, `Pay:PaymentGateway`, `:StoragePartner`) linked by
numbered messages instead of a time axis. Message numbers correspond
directly to the sequence diagram's steps 1–8 (`1.1`, `1.1.1`, `2.1`… follow
UML's nested-call numbering), so both diagrams describe one interaction from
two standard perspectives, as required for a complete behavioural view.

## State diagram — booking lifecycle (`assets/state-diagram.*`)

A state-machine diagram for the `Booking` object's `status` field, following
the proposal's explicit lifecycle: **Booked → Dropped → Stored → Picked
up**, extended with the pre-booking `PendingPayment` state and the
`Cancelled` / `Expired` terminal states implied by the payment-refund flow
in the DFDs and the proposal's escrow-style payment risk mitigation.

| State | Entered when | DFD process |
| --- | --- | --- |
| `PendingPayment` | Booking request passes availability/pricing validation | P31 |
| `Booked` | Payment is captured | P32 |
| `Dropped` | Partner verifies the check-in QR/OTP | P33 |
| `Stored` | Drop-off (with photo) is recorded | P34 |
| `PickedUp` | Partner verifies the retrieval QR/OTP | P35 |
| `Completed` | Payout is settled and a rating is requested | P4 |
| `Cancelled` | Payment fails, or the traveler cancels before drop-off | — |
| `Expired` | The booked slot window elapses with no drop-off | — |

Booking Fulfillment Time (BFT), the proposal's primary evaluation metric, is
measured from search start to entry into `Booked`.
