CREATE TABLE "instance_owners" (
	"cluster_id" uuid NOT NULL,
	"project" text NOT NULL,
	"name" text NOT NULL,
	"user_id" uuid,
	"service_account_id" uuid,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "instance_owners_cluster_id_project_name_pk" PRIMARY KEY("cluster_id","project","name"),
	CONSTRAINT "instance_owner_one_subject" CHECK (num_nonnulls("instance_owners"."user_id", "instance_owners"."service_account_id") <= 1),
	CONSTRAINT "instance_owner_source" CHECK ("instance_owners"."source" in ('incuscloud', 'event', 'backfill'))
);
--> statement-breakpoint
ALTER TABLE "tenant_members" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "instance_owners" ADD CONSTRAINT "instance_owners_cluster_id_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."clusters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instance_owners" ADD CONSTRAINT "instance_owners_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instance_owners" ADD CONSTRAINT "instance_owners_service_account_id_service_accounts_id_fk" FOREIGN KEY ("service_account_id") REFERENCES "public"."service_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Kubernetes clusters recorded their creator as a bare id: make it a subject (user:/service:), as backups do.
UPDATE "k8s_clusters" SET "created_by" = CASE WHEN EXISTS (SELECT 1 FROM "service_accounts" s WHERE s."id"::text = "k8s_clusters"."created_by") THEN 'service:' ELSE 'user:' END || "created_by" WHERE "created_by" NOT LIKE '%:%';
