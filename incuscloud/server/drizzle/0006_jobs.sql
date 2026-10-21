CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"state" text DEFAULT 'queued' NOT NULL,
	"progress" jsonb DEFAULT '{"stage":"queued"}'::jsonb NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result" jsonb,
	"error" text DEFAULT '' NOT NULL,
	"tenant_id" uuid,
	"cluster_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"instance_key" text,
	"actor_type" text NOT NULL,
	"actor_id" text NOT NULL,
	"cancel_requested" boolean DEFAULT false NOT NULL,
	"holder" text,
	"heartbeat_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "jobs_state" CHECK ("jobs"."state" in ('queued', 'running', 'succeeded', 'failed', 'cancelled'))
);
--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_active_instance" ON "jobs" USING btree ("instance_key") WHERE "jobs"."state" in ('queued', 'running');--> statement-breakpoint
CREATE INDEX "jobs_state_idx" ON "jobs" USING btree ("state","created_at");--> statement-breakpoint
CREATE INDEX "jobs_tenant_idx" ON "jobs" USING btree ("tenant_id","created_at");