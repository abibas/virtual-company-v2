ALTER TABLE "access_profiles" DROP CONSTRAINT "access_profiles_provider_check";--> statement-breakpoint
ALTER TABLE "access_profiles" ADD COLUMN "rights" jsonb;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "github_profile_id" uuid;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "atlassian_profile_id" uuid;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_github_profile_id_access_profiles_id_fk" FOREIGN KEY ("github_profile_id") REFERENCES "public"."access_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_atlassian_profile_id_access_profiles_id_fk" FOREIGN KEY ("atlassian_profile_id") REFERENCES "public"."access_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agents_github_profile_idx" ON "agents" USING btree ("github_profile_id");--> statement-breakpoint
CREATE INDEX "agents_atlassian_profile_idx" ON "agents" USING btree ("atlassian_profile_id");--> statement-breakpoint
ALTER TABLE "access_profiles" ADD CONSTRAINT "access_profiles_rights_check" CHECK (("access_profiles"."provider" in ('github', 'atlassian')) = ("access_profiles"."rights" is not null));--> statement-breakpoint
ALTER TABLE "access_profiles" ADD CONSTRAINT "access_profiles_rights_object_check" CHECK (jsonb_typeof("access_profiles"."rights") = 'object');--> statement-breakpoint
ALTER TABLE "access_profiles" ADD CONSTRAINT "access_profiles_tool_check" CHECK ("access_profiles"."provider" in ('claude', 'openai') or ("access_profiles"."gateway_credential_id" is null and "access_profiles"."model" is null and "access_profiles"."effort" is null));--> statement-breakpoint
ALTER TABLE "access_profiles" ADD CONSTRAINT "access_profiles_provider_check" CHECK ("access_profiles"."provider" in ('claude', 'openai', 'github', 'atlassian'));