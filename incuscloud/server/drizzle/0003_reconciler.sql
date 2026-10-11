CREATE TABLE "cluster_grants" (
	"cluster_id" uuid NOT NULL,
	"user" text NOT NULL,
	"relation" text NOT NULL,
	"object" text NOT NULL,
	CONSTRAINT "cluster_grants_cluster_id_user_relation_object_pk" PRIMARY KEY("cluster_id","user","relation","object")
);
--> statement-breakpoint
ALTER TABLE "clusters" ADD COLUMN "reconciled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "clusters" ADD COLUMN "grants_scanned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cluster_grants" ADD CONSTRAINT "cluster_grants_cluster_id_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."clusters"("id") ON DELETE cascade ON UPDATE no action;