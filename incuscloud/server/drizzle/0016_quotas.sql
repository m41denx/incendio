CREATE TABLE "user_quotas" (
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"quotas" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "user_quotas_tenant_id_user_id_pk" PRIMARY KEY("tenant_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "instances" ADD COLUMN "snapshots" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "user_quotas" ADD CONSTRAINT "user_quotas_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_quotas" ADD CONSTRAINT "user_quotas_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;