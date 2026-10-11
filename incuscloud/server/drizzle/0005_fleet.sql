CREATE TABLE "cluster_members" (
	"cluster_id" uuid NOT NULL,
	"name" text NOT NULL,
	"url" text DEFAULT '' NOT NULL,
	"status" text NOT NULL,
	"roles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"architecture" text DEFAULT '' NOT NULL,
	"cpu_threads" integer DEFAULT 0 NOT NULL,
	"memory_total" bigint DEFAULT 0 NOT NULL,
	"memory_used" bigint DEFAULT 0 NOT NULL,
	"load1" real,
	"uptime_s" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cluster_members_cluster_id_name_pk" PRIMARY KEY("cluster_id","name")
);
--> statement-breakpoint
CREATE TABLE "instances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cluster_id" uuid NOT NULL,
	"project" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"status" text NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"architecture" text DEFAULT '' NOT NULL,
	"created_at_incus" timestamp with time zone,
	"image_os" text DEFAULT '' NOT NULL,
	"image_release" text DEFAULT '' NOT NULL,
	"limits_cpu" text DEFAULT '' NOT NULL,
	"limits_memory" text DEFAULT '' NOT NULL,
	"cpu_ns" bigint,
	"memory_used" bigint,
	"memory_total" bigint,
	"disk_used" bigint,
	"net_rx" bigint,
	"net_tx" bigint,
	"cpu_cores" real,
	"net_rx_bps" real,
	"net_tx_bps" real,
	"addresses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"search" text NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "instances_cluster_project_name" UNIQUE("cluster_id","project","name")
);
--> statement-breakpoint
CREATE TABLE "metrics_samples" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"cluster_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"ref" text NOT NULL,
	"cpu_cores" real,
	"memory_used" bigint,
	"net_rx_bps" real,
	"net_tx_bps" real,
	"load1" real,
	CONSTRAINT "metrics_samples_kind" CHECK ("metrics_samples"."kind" in ('instance', 'member'))
);
--> statement-breakpoint
CREATE TABLE "networks" (
	"cluster_id" uuid NOT NULL,
	"project" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"managed" boolean NOT NULL,
	"status" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	CONSTRAINT "networks_cluster_id_project_name_pk" PRIMARY KEY("cluster_id","project","name")
);
--> statement-breakpoint
CREATE TABLE "storage_pools" (
	"cluster_id" uuid NOT NULL,
	"member" text NOT NULL,
	"name" text NOT NULL,
	"driver" text NOT NULL,
	"status" text NOT NULL,
	"space_total" bigint,
	"space_used" bigint,
	CONSTRAINT "storage_pools_cluster_id_member_name_pk" PRIMARY KEY("cluster_id","member","name")
);
--> statement-breakpoint
ALTER TABLE "clusters" ADD COLUMN "inventory_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "clusters" ADD COLUMN "inventory_error" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "cluster_members" ADD CONSTRAINT "cluster_members_cluster_id_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."clusters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instances" ADD CONSTRAINT "instances_cluster_id_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."clusters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metrics_samples" ADD CONSTRAINT "metrics_samples_cluster_id_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."clusters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "networks" ADD CONSTRAINT "networks_cluster_id_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."clusters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_pools" ADD CONSTRAINT "storage_pools_cluster_id_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."clusters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "instances_cluster_id_idx" ON "instances" USING btree ("cluster_id");--> statement-breakpoint
CREATE INDEX "metrics_samples_ref_idx" ON "metrics_samples" USING btree ("kind","ref","at");--> statement-breakpoint
CREATE INDEX "metrics_samples_at_idx" ON "metrics_samples" USING btree ("at");