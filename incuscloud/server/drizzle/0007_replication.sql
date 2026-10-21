CREATE TABLE "replication_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"source_cluster_id" uuid NOT NULL,
	"source_project" text NOT NULL,
	"instance_name" text NOT NULL,
	"target_cluster_id" uuid NOT NULL,
	"target_project" text NOT NULL,
	"target_name" text NOT NULL,
	"interval_s" integer DEFAULT 3600 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_error" text DEFAULT '' NOT NULL,
	"last_job_id" uuid,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "replication_policies_instance_target" UNIQUE("source_cluster_id","source_project","instance_name","target_cluster_id"),
	CONSTRAINT "replication_policies_state" CHECK ("replication_policies"."state" in ('active', 'failed-over')),
	CONSTRAINT "replication_policies_interval" CHECK ("replication_policies"."interval_s" between 60 and 604800)
);
--> statement-breakpoint
ALTER TABLE "replication_policies" ADD CONSTRAINT "replication_policies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "replication_policies" ADD CONSTRAINT "replication_policies_source_cluster_id_clusters_id_fk" FOREIGN KEY ("source_cluster_id") REFERENCES "public"."clusters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "replication_policies" ADD CONSTRAINT "replication_policies_target_cluster_id_clusters_id_fk" FOREIGN KEY ("target_cluster_id") REFERENCES "public"."clusters"("id") ON DELETE cascade ON UPDATE no action;