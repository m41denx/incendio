CREATE TABLE "placements" (
	"tenant_id" uuid NOT NULL,
	"cluster_id" uuid NOT NULL,
	"project" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"status_message" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "placements_tenant_id_cluster_id_pk" PRIMARY KEY("tenant_id","cluster_id")
);
--> statement-breakpoint
ALTER TABLE "service_accounts" ADD COLUMN "platform_role" text;--> statement-breakpoint
ALTER TABLE "placements" ADD CONSTRAINT "placements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "placements" ADD CONSTRAINT "placements_cluster_id_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."clusters"("id") ON DELETE cascade ON UPDATE no action;