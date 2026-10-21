CREATE TABLE "leases" (
	"name" text PRIMARY KEY NOT NULL,
	"holder" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clusters" ADD COLUMN "reconcile_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "clusters" ADD COLUMN "reconcile_generation" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "clusters" ADD COLUMN "reconciled_generation" integer DEFAULT 0 NOT NULL;