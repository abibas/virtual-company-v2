CREATE TABLE "access_profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"claude_credential_id" uuid,
	"openai_credential_id" uuid,
	"gateway_credential_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "access_profiles_owner_user_id_name_unique" UNIQUE("owner_user_id","name"),
	CONSTRAINT "access_profiles_name_check" CHECK (char_length("access_profiles"."name") between 1 and 80)
);
--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "default_profile_id" uuid;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "profile_id" uuid;--> statement-breakpoint
ALTER TABLE "access_profiles" ADD CONSTRAINT "access_profiles_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_profiles" ADD CONSTRAINT "access_profiles_claude_credential_id_credentials_id_fk" FOREIGN KEY ("claude_credential_id") REFERENCES "public"."credentials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_profiles" ADD CONSTRAINT "access_profiles_openai_credential_id_credentials_id_fk" FOREIGN KEY ("openai_credential_id") REFERENCES "public"."credentials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_profiles" ADD CONSTRAINT "access_profiles_gateway_credential_id_credentials_id_fk" FOREIGN KEY ("gateway_credential_id") REFERENCES "public"."credentials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_default_profile_id_access_profiles_id_fk" FOREIGN KEY ("default_profile_id") REFERENCES "public"."access_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_profile_id_access_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."access_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "memberships_default_profile_idx" ON "memberships" USING btree ("default_profile_id");--> statement-breakpoint
CREATE INDEX "agents_profile_idx" ON "agents" USING btree ("profile_id");