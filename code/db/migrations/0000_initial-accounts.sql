CREATE TYPE "public"."user_role" AS ENUM('traveler', 'storage_partner', 'admin');--> statement-breakpoint
CREATE TABLE "partner_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"business_name" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"appwrite_user_id" text NOT NULL,
	"email" text NOT NULL,
	"full_name" text DEFAULT '' NOT NULL,
	"role" "user_role" DEFAULT 'traveler' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profiles_appwrite_user_id_unique" UNIQUE("appwrite_user_id")
);
--> statement-breakpoint
ALTER TABLE "partner_profiles" ADD CONSTRAINT "partner_profiles_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_profiles_role" ON "profiles" USING btree ("role");