CREATE TABLE "backup_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"cluster_id" uuid NOT NULL,
	"project" text NOT NULL,
	"instance_name" text NOT NULL,
	"target_id" uuid NOT NULL,
	"interval_s" integer DEFAULT 86400 NOT NULL,
	"keep" integer DEFAULT 7 NOT NULL,
	"instance_only" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_error" text DEFAULT '' NOT NULL,
	"last_job_id" uuid,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "backup_policies_instance_target" UNIQUE("cluster_id","project","instance_name","target_id"),
	CONSTRAINT "backup_policies_interval" CHECK ("backup_policies"."interval_s" between 3600 and 2592000),
	CONSTRAINT "backup_policies_keep" CHECK ("backup_policies"."keep" between 1 and 365)
);
--> statement-breakpoint
CREATE TABLE "backup_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"endpoint" text NOT NULL,
	"region" text DEFAULT '' NOT NULL,
	"bucket" text NOT NULL,
	"prefix" text DEFAULT '' NOT NULL,
	"access_key_id" text NOT NULL,
	"secret_key_enc" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "backup_targets_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "backups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"policy_id" uuid,
	"target_id" uuid NOT NULL,
	"object_key" text NOT NULL,
	"cluster_id" uuid,
	"project" text NOT NULL,
	"instance_name" text NOT NULL,
	"instance_type" text DEFAULT '' NOT NULL,
	"instance_only" boolean DEFAULT false NOT NULL,
	"size_bytes" bigint,
	"state" text DEFAULT 'creating' NOT NULL,
	"error" text DEFAULT '' NOT NULL,
	"job_id" uuid,
	"transport" text DEFAULT '' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "backups_state" CHECK ("backups"."state" in ('creating', 'ready', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "backup_policies" ADD CONSTRAINT "backup_policies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backup_policies" ADD CONSTRAINT "backup_policies_cluster_id_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."clusters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backup_policies" ADD CONSTRAINT "backup_policies_target_id_backup_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."backup_targets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backups" ADD CONSTRAINT "backups_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backups" ADD CONSTRAINT "backups_policy_id_backup_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."backup_policies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backups" ADD CONSTRAINT "backups_target_id_backup_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."backup_targets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backups" ADD CONSTRAINT "backups_cluster_id_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."clusters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "backups_policy" ON "backups" USING btree ("policy_id","created_at");--> statement-breakpoint
CREATE INDEX "backups_tenant" ON "backups" USING btree ("tenant_id","created_at");