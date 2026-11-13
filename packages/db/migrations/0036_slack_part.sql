ALTER TABLE "credentials" DROP CONSTRAINT "credentials_kind_check";--> statement-breakpoint
ALTER TABLE "access_profiles" ADD COLUMN "slack_credential_id" uuid;--> statement-breakpoint
ALTER TABLE "access_profiles" ADD COLUMN "slack_rights" jsonb;--> statement-breakpoint
ALTER TABLE "access_profiles" ADD CONSTRAINT "access_profiles_slack_credential_id_credentials_id_fk" FOREIGN KEY ("slack_credential_id") REFERENCES "public"."credentials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_profiles" ADD CONSTRAINT "access_profiles_slack_check" CHECK ("access_profiles"."slack_credential_id" is null or "access_profiles"."slack_rights" is not null);--> statement-breakpoint
ALTER TABLE "access_profiles" ADD CONSTRAINT "access_profiles_slack_rights_check" CHECK (jsonb_typeof("access_profiles"."slack_rights") = 'object');--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_kind_check" CHECK ("credentials"."kind" in ('claude_oauth', 'claude_setup_token', 'codex_oauth', 'anthropic_api_key', 'openai_api_key', 'gateway', 'github_oauth', 'github_token', 'atlassian_api_token', 'slack_bot_token', 'slack_user_token'));