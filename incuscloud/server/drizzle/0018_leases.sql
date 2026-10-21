CREATE TABLE "instance_leases" (
	"cluster_id" uuid NOT NULL,
	"project" text NOT NULL,
	"name" text NOT NULL,
	"tenant_id" uuid NOT NULL,
	"expires_at" timestamp with time zone,
	"extensions" integer DEFAULT 0 NOT NULL,
	"acted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "instance_leases_cluster_id_project_name_pk" PRIMARY KEY("cluster_id","project","name")
);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "lease_policy" jsonb;--> statement-breakpoint
ALTER TABLE "instance_leases" ADD CONSTRAINT "instance_leases_cluster_id_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."clusters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instance_leases" ADD CONSTRAINT "instance_leases_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "instance_leases_expires_at_idx" ON "instance_leases" USING btree ("expires_at");