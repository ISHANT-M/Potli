CREATE TYPE "public"."booking_status" AS ENUM('pending_payment', 'booked', 'dropped', 'stored', 'picked_up', 'completed', 'cancelled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."dispute_status" AS ENUM('open', 'resolved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."handoff_method" AS ENUM('qr', 'otp');--> statement-breakpoint
CREATE TYPE "public"."handoff_type" AS ENUM('drop_off', 'pickup');--> statement-breakpoint
CREATE TYPE "public"."listing_status" AS ENUM('active', 'paused', 'flagged');--> statement-breakpoint
CREATE TYPE "public"."partner_status" AS ENUM('pending', 'approved', 'rejected', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('cod', 'upi', 'card');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'captured', 'refunded', 'payout_settled', 'failed');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"actor_role" "user_role",
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"traveler_id" uuid NOT NULL,
	"listing_id" uuid NOT NULL,
	"bag_count" integer NOT NULL,
	"slot_start" timestamp with time zone NOT NULL,
	"slot_end" timestamp with time zone NOT NULL,
	"status" "booking_status" NOT NULL,
	"quoted_paise" integer NOT NULL,
	"final_paise" integer,
	"payment_method" "payment_method" DEFAULT 'cod' NOT NULL,
	"search_started_at" timestamp with time zone,
	"booked_at" timestamp with time zone,
	"dropped_at" timestamp with time zone,
	"stored_at" timestamp with time zone,
	"picked_up_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" uuid,
	"cancel_reason" text,
	"otp_failed_attempts" integer DEFAULT 0 NOT NULL,
	"otp_locked_until" timestamp with time zone,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookings_code_unique" UNIQUE("code"),
	CONSTRAINT "bookings_traveler_idempotency_unique" UNIQUE("traveler_id","idempotency_key"),
	CONSTRAINT "bookings_bag_count_range" CHECK ("bookings"."bag_count" between 1 and 10),
	CONSTRAINT "bookings_slot_order" CHECK ("bookings"."slot_end" > "bookings"."slot_start")
);
--> statement-breakpoint
CREATE TABLE "disputes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"raised_by" uuid NOT NULL,
	"raised_by_role" "user_role" NOT NULL,
	"reason" text NOT NULL,
	"status" "dispute_status" DEFAULT 'open' NOT NULL,
	"resolution" text,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "disputes_reason_length" CHECK (char_length("disputes"."reason") between 10 and 1000)
);
--> statement-breakpoint
CREATE TABLE "fee_settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_id" uuid NOT NULL,
	"amount_paise" integer NOT NULL,
	"payment_count" integer NOT NULL,
	"reference" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"recorded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "handoff_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"type" "handoff_type" NOT NULL,
	"method" "handoff_method" NOT NULL,
	"verified_by" uuid NOT NULL,
	"bag_count" integer NOT NULL,
	"photo_file_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"verified_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "handoff_records_booking_type_unique" UNIQUE("booking_id","type")
);
--> statement-breakpoint
CREATE TABLE "listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"address" text NOT NULL,
	"area" text DEFAULT '' NOT NULL,
	"city" text NOT NULL,
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL,
	"capacity" integer NOT NULL,
	"hourly_rate_paise" integer NOT NULL,
	"daily_cap_paise" integer NOT NULL,
	"open_time" time NOT NULL,
	"close_time" time NOT NULL,
	"open_days" smallint[] DEFAULT '{0,1,2,3,4,5,6}'::smallint[] NOT NULL,
	"cover_file_id" text,
	"status" "listing_status" DEFAULT 'active' NOT NULL,
	"flag_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "listings_capacity_range" CHECK ("listings"."capacity" between 1 and 200),
	CONSTRAINT "listings_hourly_rate_range" CHECK ("listings"."hourly_rate_paise" between 1000 and 100000),
	CONSTRAINT "listings_daily_cap_range" CHECK ("listings"."daily_cap_paise" >= "listings"."hourly_rate_paise" and "listings"."daily_cap_paise" <= 24 * "listings"."hourly_rate_paise"),
	CONSTRAINT "listings_hours_order" CHECK ("listings"."close_time" > "listings"."open_time")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"method" "payment_method" NOT NULL,
	"status" "payment_status" DEFAULT 'pending' NOT NULL,
	"amount_paise" integer NOT NULL,
	"platform_fee_paise" integer DEFAULT 0 NOT NULL,
	"partner_share_paise" integer DEFAULT 0 NOT NULL,
	"collected_at" timestamp with time zone,
	"collected_by" uuid,
	"settlement_id" uuid,
	"gateway_reference" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_booking_id_unique" UNIQUE("booking_id")
);
--> statement-breakpoint
CREATE TABLE "ratings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"traveler_id" uuid NOT NULL,
	"listing_id" uuid NOT NULL,
	"score" smallint NOT NULL,
	"comment" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ratings_booking_id_unique" UNIQUE("booking_id"),
	CONSTRAINT "ratings_score_range" CHECK ("ratings"."score" between 1 and 5)
);
--> statement-breakpoint
ALTER TABLE "partner_profiles" ADD COLUMN "business_type" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "partner_profiles" ADD COLUMN "address" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "partner_profiles" ADD COLUMN "city" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "partner_profiles" ADD COLUMN "status" "partner_status" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "partner_profiles" ADD COLUMN "rejection_reason" text;--> statement-breakpoint
ALTER TABLE "partner_profiles" ADD COLUMN "reviewed_by" uuid;--> statement-breakpoint
ALTER TABLE "partner_profiles" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "partner_profiles" ADD COLUMN "submitted_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "partner_profiles" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "phone" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "is_disabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "disabled_reason" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_profiles_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_traveler_id_profiles_id_fk" FOREIGN KEY ("traveler_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_cancelled_by_profiles_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_raised_by_profiles_id_fk" FOREIGN KEY ("raised_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_resolved_by_profiles_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_settlements" ADD CONSTRAINT "fee_settlements_partner_id_profiles_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_settlements" ADD CONSTRAINT "fee_settlements_recorded_by_profiles_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoff_records" ADD CONSTRAINT "handoff_records_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoff_records" ADD CONSTRAINT "handoff_records_verified_by_profiles_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_partner_id_profiles_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_collected_by_profiles_id_fk" FOREIGN KEY ("collected_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_settlement_id_fee_settlements_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."fee_settlements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_traveler_id_profiles_id_fk" FOREIGN KEY ("traveler_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_audit_entity" ON "audit_log" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX "idx_audit_created" ON "audit_log" USING btree ("created_at" desc);--> statement-breakpoint
CREATE INDEX "idx_bookings_listing_window" ON "bookings" USING btree ("listing_id","status","slot_start","slot_end");--> statement-breakpoint
CREATE INDEX "idx_bookings_traveler" ON "bookings" USING btree ("traveler_id","created_at" desc);--> statement-breakpoint
CREATE INDEX "idx_bookings_status" ON "bookings" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_disputes_status_created" ON "disputes" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_open_dispute_per_raiser" ON "disputes" USING btree ("booking_id","raised_by") WHERE "disputes"."status" = 'open';--> statement-breakpoint
CREATE INDEX "idx_listings_partner" ON "listings" USING btree ("partner_id");--> statement-breakpoint
CREATE INDEX "idx_listings_status" ON "listings" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_listings_city" ON "listings" USING btree (lower("city"));--> statement-breakpoint
CREATE INDEX "idx_payments_status_settlement" ON "payments" USING btree ("status","settlement_id");--> statement-breakpoint
CREATE INDEX "idx_ratings_listing" ON "ratings" USING btree ("listing_id");--> statement-breakpoint
ALTER TABLE "partner_profiles" ADD CONSTRAINT "partner_profiles_reviewed_by_profiles_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_partner_profiles_status" ON "partner_profiles" USING btree ("status");