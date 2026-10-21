CREATE TABLE "gateway_requests" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"cluster_id" uuid,
	"actor_type" text NOT NULL,
	"actor_id" text NOT NULL,
	"method" text NOT NULL,
	"path" text NOT NULL,
	"status" integer NOT NULL,
	"bytes_in" bigint NOT NULL,
	"bytes_out" bigint NOT NULL,
	"duration_ms" integer NOT NULL,
	"ip" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gateway_requests" ADD CONSTRAINT "gateway_requests_cluster_id_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."clusters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gateway_requests_cluster_id_idx" ON "gateway_requests" USING btree ("cluster_id","id");--> statement-breakpoint
CREATE INDEX "gateway_requests_actor_id_idx" ON "gateway_requests" USING btree ("actor_id","id");