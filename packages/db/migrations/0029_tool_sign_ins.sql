ALTER TABLE "credentials" DROP CONSTRAINT "credentials_kind_check";--> statement-breakpoint
ALTER TABLE "credentials" ADD COLUMN "checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "credentials" ADD COLUMN "check_error" text;--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_check_error_check" CHECK ("credentials"."check_error" in ('provider_unavailable', 'rate_limited', 'refused', 'invalid_response', 'no_products', 'check_failed'));--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_kind_check" CHECK ("credentials"."kind" in ('claude_oauth', 'claude_setup_token', 'codex_oauth', 'anthropic_api_key', 'openai_api_key', 'gateway', 'github_oauth', 'github_token', 'atlassian_api_token'));