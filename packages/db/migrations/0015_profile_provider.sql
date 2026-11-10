ALTER TABLE "access_profiles" ADD COLUMN "provider" text;--> statement-breakpoint
ALTER TABLE "access_profiles" ADD COLUMN "credential_id" uuid;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "default_claude_profile_id" uuid;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "default_openai_profile_id" uuid;--> statement-breakpoint
ALTER TABLE "access_profiles" ADD CONSTRAINT "access_profiles_credential_id_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."credentials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_default_claude_profile_id_access_profiles_id_fk" FOREIGN KEY ("default_claude_profile_id") REFERENCES "public"."access_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_default_openai_profile_id_access_profiles_id_fk" FOREIGN KEY ("default_openai_profile_id") REFERENCES "public"."access_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "memberships_default_claude_profile_idx" ON "memberships" USING btree ("default_claude_profile_id");--> statement-breakpoint
CREATE INDEX "memberships_default_openai_profile_idx" ON "memberships" USING btree ("default_openai_profile_id");--> statement-breakpoint
-- custom: the data step, which drizzle-kit does not write. It runs after the new columns above and before the old slot
-- columns go below (drizzle-kit wrote those statements as a second step, joined into this file so the change is one
-- migration). Until now a profile bundled a Claude slot, an OpenAI slot and a gateway; now each has one provider:
--   a Claude subscription only, or none (with or without a gateway): a Claude profile with it and its gateway;
--   an OpenAI subscription only: an OpenAI profile with it; a gateway it had is let go (only Claude profiles have one);
--   both: it stays a Claude profile with its gateway, and a new OpenAI profile of the same owner, named
--   "<name> · OpenAI" (then " · OpenAI 2", " 3"... when taken, the name cut to fit 80 characters), takes the OpenAI
--   subscription; the `codex` agents and chats on the original move to it, and a member whose default was the
--   original keeps it as their Claude default and gets the new one as their OpenAI default.
-- Then every member's default goes to the column of its profile's provider, and an agent or chat left on a profile of
-- the other provider than its harness (say a Codex agent on a profile that had only a Claude subscription) loses it,
-- as a harness change does now. The audit log gets each new profile, each agent and chat moved or cleared, each
-- OpenAI default set and each gateway let go, by the system, with the request id `migration:0015_profile_provider`.
DO $$
DECLARE
	bundle record;
	sibling uuid;
	suffix text;
	candidate text;
	n integer;
BEGIN
	FOR bundle IN
		SELECT "id", "owner_user_id", "name", "openai_credential_id" FROM "access_profiles"
		WHERE "claude_credential_id" IS NOT NULL AND "openai_credential_id" IS NOT NULL
		ORDER BY "created_at", "id"
	LOOP
		n := 1;
		LOOP
			suffix := ' · OpenAI' || CASE WHEN n = 1 THEN '' ELSE ' ' || n END;
			candidate := left(bundle."name", 80 - char_length(suffix)) || suffix;
			EXIT WHEN NOT EXISTS (
				SELECT 1 FROM "access_profiles" WHERE "owner_user_id" = bundle."owner_user_id" AND "name" = candidate
			);
			n := n + 1;
		END LOOP;
		sibling := gen_random_uuid();
		INSERT INTO "access_profiles" ("id", "owner_user_id", "name", "provider", "credential_id")
		VALUES (sibling, bundle."owner_user_id", candidate, 'openai', bundle."openai_credential_id");
		INSERT INTO "audit_log" ("actor_kind", "entity_type", "entity_id", "action", "field", "new_value", "request_id")
		VALUES
			('system', 'access_profile', sibling::text, 'create', 'credentialId',
				to_jsonb(bundle."openai_credential_id"::text), 'migration:0015_profile_provider'),
			('system', 'access_profile', sibling::text, 'create', 'name', to_jsonb(candidate),
				'migration:0015_profile_provider'),
			('system', 'access_profile', sibling::text, 'create', 'ownerUserId', to_jsonb(bundle."owner_user_id"::text),
				'migration:0015_profile_provider'),
			('system', 'access_profile', sibling::text, 'create', 'provider', to_jsonb('openai'::text),
				'migration:0015_profile_provider');
		WITH "moved" AS (
			UPDATE "agents" SET "profile_id" = sibling
			WHERE "profile_id" = bundle."id" AND "harness" = 'codex'
			RETURNING "company_id", "id"
		)
		INSERT INTO "audit_log"
			("company_id", "actor_kind", "entity_type", "entity_id", "action", "field", "old_value", "new_value", "request_id")
		SELECT "company_id", 'system', 'agent', "id"::text, 'update', 'profileId', to_jsonb(bundle."id"::text),
			to_jsonb(sibling::text), 'migration:0015_profile_provider'
		FROM "moved";
		WITH "moved" AS (
			UPDATE "chats" SET "profile_id" = sibling
			WHERE "profile_id" = bundle."id" AND "harness" = 'codex'
			RETURNING "company_id", "id"
		)
		INSERT INTO "audit_log"
			("company_id", "actor_kind", "entity_type", "entity_id", "action", "field", "old_value", "new_value", "request_id")
		SELECT "company_id", 'system', 'chat', "id"::text, 'update', 'profileId', to_jsonb(bundle."id"::text),
			to_jsonb(sibling::text), 'migration:0015_profile_provider'
		FROM "moved";
		WITH "chosen" AS (
			UPDATE "memberships" SET "default_openai_profile_id" = sibling
			WHERE "default_profile_id" = bundle."id"
			RETURNING "company_id", "id"
		)
		INSERT INTO "audit_log"
			("company_id", "actor_kind", "entity_type", "entity_id", "action", "field", "new_value", "request_id")
		SELECT "company_id", 'system', 'membership', "id"::text, 'update', 'defaultOpenaiProfileId',
			to_jsonb(sibling::text), 'migration:0015_profile_provider'
		FROM "chosen";
	END LOOP;
END $$;
--> statement-breakpoint
INSERT INTO "audit_log" ("actor_kind", "entity_type", "entity_id", "action", "field", "old_value", "request_id")
SELECT 'system', 'access_profile', "id"::text, 'update', 'gatewayCredentialId', to_jsonb("gateway_credential_id"::text),
	'migration:0015_profile_provider'
FROM "access_profiles"
WHERE "claude_credential_id" IS NULL AND "openai_credential_id" IS NOT NULL AND "gateway_credential_id" IS NOT NULL;
--> statement-breakpoint
UPDATE "access_profiles" SET
	"provider" = CASE WHEN "claude_credential_id" IS NULL AND "openai_credential_id" IS NOT NULL THEN 'openai' ELSE 'claude' END,
	"credential_id" = coalesce("claude_credential_id", "openai_credential_id"),
	"gateway_credential_id" = CASE
		WHEN "claude_credential_id" IS NULL AND "openai_credential_id" IS NOT NULL THEN NULL
		ELSE "gateway_credential_id"
	END
WHERE "provider" IS NULL;
--> statement-breakpoint
UPDATE "memberships" SET
	"default_claude_profile_id" = CASE WHEN "p"."provider" = 'claude' THEN "p"."id" END,
	"default_openai_profile_id" = coalesce(
		"memberships"."default_openai_profile_id",
		CASE WHEN "p"."provider" = 'openai' THEN "p"."id" END
	)
FROM "access_profiles" "p"
WHERE "p"."id" = "memberships"."default_profile_id";
--> statement-breakpoint
WITH "cleared" AS (
	UPDATE "agents" SET "profile_id" = NULL
	FROM "access_profiles" "p"
	WHERE "p"."id" = "agents"."profile_id"
		AND "p"."provider" <> CASE "agents"."harness" WHEN 'codex' THEN 'openai' ELSE 'claude' END
	RETURNING "agents"."company_id", "agents"."id", "p"."id" AS "profile_id"
)
INSERT INTO "audit_log"
	("company_id", "actor_kind", "entity_type", "entity_id", "action", "field", "old_value", "request_id")
SELECT "company_id", 'system', 'agent', "id"::text, 'update', 'profileId', to_jsonb("profile_id"::text),
	'migration:0015_profile_provider'
FROM "cleared";
--> statement-breakpoint
WITH "cleared" AS (
	UPDATE "chats" SET "profile_id" = NULL, "profile_set_by" = NULL
	FROM "access_profiles" "p"
	WHERE "p"."id" = "chats"."profile_id"
		AND "p"."provider" <> CASE "chats"."harness" WHEN 'codex' THEN 'openai' ELSE 'claude' END
	RETURNING "chats"."company_id", "chats"."id", "p"."id" AS "profile_id"
)
INSERT INTO "audit_log"
	("company_id", "actor_kind", "entity_type", "entity_id", "action", "field", "old_value", "request_id")
SELECT "company_id", 'system', 'chat', "id"::text, 'update', 'profileId', to_jsonb("profile_id"::text),
	'migration:0015_profile_provider'
FROM "cleared";
--> statement-breakpoint
-- The second step drizzle-kit wrote: the old slot columns and the single default go, and the provider's rules hold.
ALTER TABLE "access_profiles" DROP CONSTRAINT "access_profiles_claude_credential_id_credentials_id_fk";
--> statement-breakpoint
ALTER TABLE "access_profiles" DROP CONSTRAINT "access_profiles_openai_credential_id_credentials_id_fk";
--> statement-breakpoint
ALTER TABLE "memberships" DROP CONSTRAINT "memberships_default_profile_id_access_profiles_id_fk";
--> statement-breakpoint
DROP INDEX "memberships_default_profile_idx";--> statement-breakpoint
ALTER TABLE "access_profiles" ALTER COLUMN "provider" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "access_profiles" DROP COLUMN "claude_credential_id";--> statement-breakpoint
ALTER TABLE "access_profiles" DROP COLUMN "openai_credential_id";--> statement-breakpoint
ALTER TABLE "memberships" DROP COLUMN "default_profile_id";--> statement-breakpoint
ALTER TABLE "access_profiles" ADD CONSTRAINT "access_profiles_provider_check" CHECK ("access_profiles"."provider" in ('claude', 'openai'));--> statement-breakpoint
ALTER TABLE "access_profiles" ADD CONSTRAINT "access_profiles_gateway_check" CHECK ("access_profiles"."provider" = 'claude' or "access_profiles"."gateway_credential_id" is null);