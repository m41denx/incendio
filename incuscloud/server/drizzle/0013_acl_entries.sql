CREATE TABLE "acl_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"path" text NOT NULL,
	"user_id" uuid,
	"service_account_id" uuid,
	"role" text NOT NULL,
	"propagate" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "acl_entry_unique" UNIQUE NULLS NOT DISTINCT("path","user_id","service_account_id","role"),
	CONSTRAINT "acl_entry_one_subject" CHECK (num_nonnulls("acl_entries"."user_id", "acl_entries"."service_account_id") = 1)
);
--> statement-breakpoint
ALTER TABLE "acl_entries" ADD CONSTRAINT "acl_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acl_entries" ADD CONSTRAINT "acl_entries_service_account_id_service_accounts_id_fk" FOREIGN KEY ("service_account_id") REFERENCES "public"."service_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acl_entries" ADD CONSTRAINT "acl_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "acl_entries_path" ON "acl_entries" USING btree ("path");