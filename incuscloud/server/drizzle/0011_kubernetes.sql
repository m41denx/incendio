CREATE TABLE "k8s_clusters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"cluster_id" uuid NOT NULL,
	"name" text NOT NULL,
	"namespace" text NOT NULL,
	"version" text NOT NULL,
	"control_planes" integer NOT NULL,
	"workers" integer NOT NULL,
	"size" text NOT NULL,
	"endpoint_host" text NOT NULL,
	"endpoint_port" integer NOT NULL,
	"lb_member" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'creating' NOT NULL,
	"status_message" text DEFAULT '' NOT NULL,
	"nodes" integer DEFAULT 0 NOT NULL,
	"nodes_ready" integer DEFAULT 0 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"synced_at" timestamp with time zone,
	CONSTRAINT "k8s_clusters_tenant_name" UNIQUE("tenant_id","name"),
	CONSTRAINT "k8s_clusters_endpoint" UNIQUE("cluster_id","endpoint_host","endpoint_port"),
	CONSTRAINT "k8s_clusters_status" CHECK ("k8s_clusters"."status" in ('creating', 'provisioning', 'ready', 'degraded', 'deleting', 'error')),
	CONSTRAINT "k8s_clusters_size" CHECK ("k8s_clusters"."size" in ('small', 'medium', 'large'))
);
--> statement-breakpoint
CREATE TABLE "k8s_credentials" (
	"tenant_id" uuid NOT NULL,
	"cluster_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "k8s_credentials_tenant_id_cluster_id_pk" PRIMARY KEY("tenant_id","cluster_id")
);
--> statement-breakpoint
ALTER TABLE "k8s_clusters" ADD CONSTRAINT "k8s_clusters_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "k8s_clusters" ADD CONSTRAINT "k8s_clusters_cluster_id_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."clusters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "k8s_credentials" ADD CONSTRAINT "k8s_credentials_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "k8s_credentials" ADD CONSTRAINT "k8s_credentials_cluster_id_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."clusters"("id") ON DELETE cascade ON UPDATE no action;