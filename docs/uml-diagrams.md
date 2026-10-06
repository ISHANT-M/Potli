# POTLI UML Diagrams (Sequence, Class, Collaboration, Component)

This document explains the behavioural and structural UML diagrams that
complement the [use-case diagram](../assets/use-case-diagram.svg), the
[activity diagram](../assets/activity-diagram.svg), and the
[data flow diagrams](data-flow-diagrams.md). Together they model the
**designed system** described in the project `README.md` and
`project-proposal/main.tex`.

The [component diagram](#component-diagram) describes the current physical implementation separately from the designed workflows below.

## Implemented vs planned

POTLI is in the **planning and design phase**. The only implemented code is
the static frontend shell, a versioned auth API (`/api/v1/auth/login`,
`/api/v1/auth/me`), and a `profiles` / `partner_profiles` schema (see
`code/`). Everything else shown below — search, booking, QR/OTP handoff,
payments, payouts, ratings, admin oversight — is the **planned/designed
system**, grounded in the README capabilities table, the proposal's core
workflow, and the data flow diagrams' numbered processes (P1–P5, P31–P35)
and data stores (D1–D4). Every class, message, and state below traces to one
of those sources; nothing is invented beyond the level of detail needed to
draw a complete diagram.

## Conventions

- Editable sources: `assets/{sequence,class,collaboration}-diagram.mmd`
  (Mermaid), rendered with the Mermaid CLI (`mmdc`) to SVG and 2x PNG, the
  same pipeline used for the DFDs.
- Process references such as `(P31)` or `(P4)` point at the matching process
  in [Data Flow Diagrams](data-flow-diagrams.md), so the same operation can
  be traced across every diagram in the project.

## Sequence diagram — booking and handoff workflow (`assets/sequence-diagram.*`)

Shows the primary designed interaction end to end: a traveler searching for
storage, logging in, confirming a booking, the drop-off handoff, and the
pickup and payout settlement. Participants are the Traveler and Storage
Partner (actors), the Web App (frontend), the Backend API, the Database, and
the Payment Gateway (UPI) — mirroring the DFD Level 0 external entities and
the Level 1/2 processes. Every synchronous call is bracketed by an
activation (execution occurrence) on the receiving lifeline, closed once its
reply is sent, per standard sequence-diagram notation.

- **Discovery** (`P2`): the traveler searches and browses storage options
  before authenticating, matching the implemented public landing/search flow.
- **Login** (`P1`): the traveler signs in via the implemented
  `POST /api/v1/auth/login` endpoint before a booking can be created,
  matching the JWT-based auth already in `code/backend`.
- **Booking** (`P31`, `P32`): availability validation, payment capture,
  booking record creation, and QR/OTP generation, authorized with the
  bearer token from login.
- **Drop-off handoff** (`P33`, `P34`): the partner scans the check-in
  code, the API matches it against the booking record, and the drop-off
  (with photo) is recorded.
- **Pickup & settlement** (`P35`, `P4`): the partner verifies the retrieval
  code, the booking is completed, availability is restored, and the
  partner payout is released through the payment gateway. The traveler is
  then prompted for a post-pickup rating.

## Class diagram — domain model (`assets/class-diagram.*`)

Models the core objects behind the data stores D1–D4 and the capabilities
table in the README. `User` is an abstract base (matching Supabase Auth's `auth.users`
plus the `role` enum on `public.profiles`) specialised by
`Traveler`, `StoragePartner`, and `Administrator`. Key relationships:

| Relationship | Meaning |
| --- | --- |
| `User <|-- Traveler / StoragePartner / Administrator` | Role specialisation (generalisation), matching `profiles.role` |
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

<!--
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
-->


## Component diagram

Follows **UML Diagrams III**, slides 14-17: physical code components, libraries, files and database dependencies rather than logical business processes or deployment hardware.

- Rectangles with the UML component icon identify components; the folded-corner symbol identifies a file.
- Dashed, open-arrow dependencies point from a consumer to what it uses.
- Circles represent provided interfaces; semicircles represent required interfaces. Joined symbols show assembly connections.

| Component | Implementation |
| --- | --- |
| Browser application | `code/frontend`, built by Vite from `src/main.ts` and `src/styles.css`; requires the backend REST API and imports the Appwrite Web SDK |
| Backend API | `code/backend/src/server.ts`, using Node.js and Express; provides `/api/v1` endpoints and depends on configuration, identity and database access |
| Appwrite Web SDK | `appwrite` library wrapped by `code/frontend/src/appwrite.ts`; requires Appwrite's Account API for sessions and JWTs |
| Identity adapter | `code/backend/src/appwrite.ts`; uses Appwrite's Account API for sign-in and JWT verification |
| Configuration file | `code/backend/src/config.ts`; supplies environment settings |
| Database workspace | `code/db/client.ts`, `profiles.ts` and `schema.ts`, using Drizzle ORM and `pg`; consumed through `code/backend/src/db.ts` |
| Appwrite Auth | External identity component providing accounts, sessions, JWTs and credential storage |
| PostgreSQL | Application database with `profiles` and `partner_profiles`; credentials remain in Appwrite |

This diagram reflects the current working-tree implementation, including Appwrite. Planned booking, handoff and payment modules are not represented as implemented components. `assets/component-diagram.mmd` is the corresponding Mermaid source, with the same components, dependencies and named interfaces. Mermaid represents interfaces as circles with labeled requires/provides links; `assets/component-diagram.svg` retains the lecture's native UML component icons and socket notation. `assets/component-diagram.drawio` provides editable components, connectors and interface symbols in draw.io. `assets/component-diagram.png` is the SVG's rendered export.
