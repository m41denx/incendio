CREATE TABLE "balancing_policies" (
	"cluster_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"method" text DEFAULT 'memory' NOT NULL,
	"mode" text DEFAULT 'used' NOT NULL,
	"balanciness" integer DEFAULT 10 NOT NULL,
	"interval_s" integer DEFAULT 3600 NOT NULL,
	"max_moves" integer DEFAULT 5 NOT NULL,
	"allow_restart" boolean DEFAULT false NOT NULL,
	"exclude_members" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"exclude_projects" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_error" text DEFAULT '' NOT NULL,
	"last_job_id" uuid,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "balancing_policies_method" CHECK ("balancing_policies"."method" in ('memory', 'cpu', 'disk')),
	CONSTRAINT "balancing_policies_mode" CHECK ("balancing_policies"."mode" in ('used', 'assigned')),
	CONSTRAINT "balancing_policies_balanciness" CHECK ("balancing_policies"."balanciness" between 1 and 100),
	CONSTRAINT "balancing_policies_interval" CHECK ("balancing_policies"."interval_s" between 300 and 86400),
	CONSTRAINT "balancing_policies_max_moves" CHECK ("balancing_policies"."max_moves" between 1 and 50)
);
--> statement-breakpoint
ALTER TABLE "instances" ADD COLUMN "hints" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "balancing_policies" ADD CONSTRAINT "balancing_policies_cluster_id_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."clusters"("id") ON DELETE cascade ON UPDATE no action;