CREATE TABLE "group_members" (
	"group_id" uuid NOT NULL,
	"user_id" uuid,
	"service_account_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_member_unique" UNIQUE NULLS NOT DISTINCT("group_id","user_id","service_account_id"),
	CONSTRAINT "group_member_one" CHECK (num_nonnulls("group_members"."user_id", "group_members"."service_account_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "groups_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "acl_entries" DROP CONSTRAINT "acl_entry_unique";--> statement-breakpoint
ALTER TABLE "acl_entries" DROP CONSTRAINT "acl_entry_one_subject";--> statement-breakpoint
ALTER TABLE "acl_entries" ADD COLUMN "group_id" uuid;--> statement-breakpoint
ALTER TABLE "acl_entries" ADD COLUMN "tenant_group_id" uuid;--> statement-breakpoint
ALTER TABLE "cluster_members" ADD COLUMN "groups" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_service_account_id_service_accounts_id_fk" FOREIGN KEY ("service_account_id") REFERENCES "public"."service_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acl_entries" ADD CONSTRAINT "acl_entries_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acl_entries" ADD CONSTRAINT "acl_entries_tenant_group_id_tenants_id_fk" FOREIGN KEY ("tenant_group_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acl_entries" ADD CONSTRAINT "acl_entry_unique" UNIQUE NULLS NOT DISTINCT("path","user_id","service_account_id","group_id","tenant_group_id","role");--> statement-breakpoint
ALTER TABLE "acl_entries" ADD CONSTRAINT "acl_entry_one_subject" CHECK (num_nonnulls("acl_entries"."user_id", "acl_entries"."service_account_id", "acl_entries"."group_id", "acl_entries"."tenant_group_id") = 1);