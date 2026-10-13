# POTLI UML Diagrams (Sequence, Class, Collaboration, State, Component)

This document explains the behavioural and structural UML diagrams that
complement the [use-case diagram](../assets/use-case-diagram.svg), the
[activity diagram](../assets/activity-diagram.svg), and the
[data flow diagrams](data-flow-diagrams.md). Together they model the
**designed system** described in the project `README.md` and
`project-proposal/main.tex`.

The [component diagram](#component-diagram) describes the current physical implementation separately from the designed workflows below.

## Implemented vs planned

The diagrams describe the implemented system (`code/`): three portals, search,
cash-on-pickup booking, QR/OTP handoff with drop-off photographs, a 15%
platform fee ledger, partner approval, ratings, disputes and an audit log.
**Cash on pickup is the only live payment method.** The Payment Gateway (UPI)
and the `PendingPayment` state are kept as planned (online payments, coming
soon). No field pilot or deployment has been done.

## Conventions

- Editable sources: `assets/{sequence,class,collaboration}-diagram.mmd`
  (Mermaid), rendered with the Mermaid CLI (`mmdc`) to SVG and 2x PNG, the
  same pipeline used for the DFDs.
- Process references such as `(P31)` or `(P4)` point at the matching process
  in [Data Flow Diagrams](data-flow-diagrams.md), so the same operation can
  be traced across every diagram in the project.

## Sequence diagram - booking and handoff workflow (`assets/sequence-diagram.*`)

Shows the primary interaction end to end. Participants are the Traveler and
Storage Partner (actors), the Web App, the Backend API, the Database, Appwrite
Auth, Appwrite Storage, and the Payment Gateway, marked as planned (UPI,
coming soon) with no active calls. Every synchronous call is bracketed by an
activation on the receiving lifeline.

- **Discovery** (`P2`): the traveler searches by list or map before authenticating.
- **Login** (`P1`): the web app creates an Appwrite session and JWT, then calls
  `GET /auth/me`; the backend verifies the JWT with Appwrite and loads the profile.
- **Booking, cash on pickup** (`P31`, `P32`): the slot, opening hours and quote
  are validated, the listing is locked, capacity re-checked and the booking
  created as `Booked`. Nothing is charged at booking.
- **Drop-off handoff** (`P33`, `P34`): the partner submits the OTP or QR, then
  uploads photographs, which go to a private Appwrite bucket; the drop-off is recorded.
- **Pickup and cash collection** (`P35`, `P4`): the partner verifies the pickup
  code and records cash collected; the final price (including overstay) and the
  15% platform fee are recorded and the booking is `Completed`. An admin later
  records the fee settlement. The traveler may then rate the booking.

## Class diagram — domain model (`assets/class-diagram.*`)

Models the core objects behind the data stores D1–D4 and the capabilities
table in the README. `User` is an abstract base (matching Appwrite's users
plus the `role` enum on `profiles`) specialised by
`Traveler`, `StoragePartner`, and `Administrator`. Key relationships:

| Relationship | Meaning |
| --- | --- |
| `User <|-- Traveler / StoragePartner / Administrator` | Role specialisation (generalisation), matching `profiles.role` |
| `StoragePartner *-- PartnerProfile` | Business details and approval status, matching `partner_profiles` |
| `StoragePartner o-- StorageListing` | A partner manages zero or more listings (D2) |
| `Traveler --> Booking` | A traveler makes zero or more bookings (D3) |
| `Booking *-- HandoffRecord` | Drop-off and pickup proof, including the photograph (D3) |
| `Booking *-- Payment` | Payment method, platform fee, partner share and fee settlement (D4) |
| `FeeSettlement o-- Payment` | Admin-recorded settlement of platform fees owed by a partner |
| `Booking o-- Dispute` | Disputes raised by travellers or partners |
| `Booking o-- Rating` | Optional post-pickup rating (README: "Rate the experience") |
| `Administrator ..> StorageListing / Booking` | Verification and audit, read-only dependency (P5) |

Attributes match `code/db/schema.ts` (amounts in paise). Credentials are held
by Appwrite, so `User` has no password hash. `AuditLog` is a minimal class.
Enumerations (`Role`, `BookingStatus`, `PaymentStatus`, `PaymentMethod`,
`PartnerStatus`, `ListingStatus`, `HandoffType`, `HandoffMethod`,
`DisputeStatus`) match the database enum types.

## Collaboration diagram - search, login and booking (`assets/collaboration-diagram.*`)

The communication-diagram view of the first sequence phases, drawn as objects
(`:Traveler`, `W:WebApp`, `API:BookingService`, `IdP:AppwriteAuth`,
`D2:ListingStore`, `D3:BookingStore`, `:StoragePartner`, and the planned
`Pay:PaymentGateway`) linked by numbered messages. Message 1 is search, 2 is
login (Appwrite session and JWT, then `getMe`), and 3 is the cash-on-pickup
booking (listing lock and capacity check, booking saved as `Booked`). The
gateway is shown only through a dashed, planned charge message.

## State diagram - booking lifecycle (`assets/state-diagram.*`)

| State | Entered when | DFD process |
| --- | --- | --- |
| `Booked` | Cash-on-pickup booking is validated and created (initial state) | P31, P32 |
| `PendingPayment` | Online payments, coming soon: initial state until payment is captured | P31 |
| `Dropped` | Partner verifies the check-in QR/OTP | P33 |
| `Stored` | Drop-off photo is recorded | P34 |
| `PickedUp` | Partner verifies the retrieval QR/OTP | P35 |
| `Completed` | Cash collected and 15% fee recorded | P4 |
| `Cancelled` | Traveller, partner or admin cancels (admin only from `Dropped`/`Stored`) | - |
| `Expired` | Slot window elapses with no drop-off | - |

Refunds apply only to future online payments. BFT is measured from search
start to entry into `Booked`.
 Booking` | A traveler makes zero or more bookings (D3) |
| `Booking *-- HandoffRecord` | Drop-off and pickup proof, including the photograph (D3) |
| `Booking *-- Payment` | Payment method, platform fee, partner share and fee settlement (D4) |
| `FeeSettlement o-- Payment` | Admin-recorded settlement of platform fees owed by a partner |
| `Booking o-- Dispute` | Disputes raised by travellers or partners |
| `Booking o-- Rating` | Optional post-pickup rating (README: "Rate the experience") |
| `Administrator ..> StorageListing / Booking` | Verification and audit, read-only dependency (P5) |

Attributes match `code/db/schema.ts` (amounts in paise). Credentials are held
by Appwrite, so `User` has no password hash. `AuditLog` is a minimal class.
Enumerations (`Role`, `BookingStatus`, `PaymentStatus`, `PaymentMethod`,
`PartnerStatus`, `ListingStatus`, `HandoffType`, `HandoffMethod`,
`DisputeStatus`) match the database enum types.

## Collaboration diagram - search, login and booking (`assets/collaboration-diagram.*`)

The communication-diagram view of the first sequence phases, drawn as objects
(`:Traveler`, `W:WebApp`, `API:BookingService`, `IdP:AppwriteAuth`,
`D2:ListingStore`, `D3:BookingStore`, `:StoragePartner`, and the planned
`Pay:PaymentGateway`) linked by numbered messages. Message 1 is search, 2 is
login (Appwrite session and JWT, then `getMe`), and 3 is the cash-on-pickup
booking (listing lock and capacity check, booking saved as `Booked`). The
gateway is shown only through a dashed, planned charge message.

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
| Browser application | `code/frontend`: traveller, partner and admin portals, Vite bundle, Leaflet map; requires the REST API, imports the Appwrite Web SDK and the shared module |
| Appwrite Web SDK | Wrapped by `frontend/src/appwrite.ts`; sessions, JWTs, recovery |
| Backend API | `code/backend/src/app.ts` (Express); provides `/api/v1`, mounts routers, starts the expiry job |
| HTTP middleware | `backend/src/http`: auth guards, validation, rate limit, upload |
| Routers | `backend/src/routes`: traveller, partner, admin, files, system |
| Handoff code service | `backend/src/lib/handoff.ts`: derived OTP, QR payload, attempt lockout |
| Expiry job | `backend/src/jobs.ts`: expires bookings never dropped off |
| Shared domain module | `code/shared`: status transitions, pricing and fee, types |
| Identity adapter | `backend/src/appwrite.ts`: JWT verification and file storage calls |
| Configuration file | `backend/src/config.ts` |
| Database workspace | `code/db`: Drizzle ORM, `pg`, migrations |
| Appwrite Auth | External: accounts, sessions, JWTs, email verification, recovery |
| Appwrite Storage | External: private `handoff-photos` and `listing-photos` buckets |
| PostgreSQL | `profiles`, `partner_profiles`, `listings`, `bookings`, `handoff_records`, `payments`, `fee_settlements`, `ratings`, `disputes`, `audit_log` |

This diagram reflects the current implementation. `assets/component-diagram.mmd` is the corresponding Mermaid source, with the same components, dependencies and named interfaces. Mermaid represents interfaces as circles with labeled requires/provides links; `assets/component-diagram.svg` and `.png` are now rendered from the Mermaid source; `assets/component-diagram.drawio` is stale (it shows the earlier, smaller component set) and has not been updated.
