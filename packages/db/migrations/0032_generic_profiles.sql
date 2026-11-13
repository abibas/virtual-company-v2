ALTER TABLE "access_profiles" ADD COLUMN "claude_part" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "access_profiles" ADD COLUMN "claude_credential_id" uuid;--> statement-breakpoint
ALTER TABLE "access_profiles" ADD COLUMN "claude_gateway_credential_id" uuid;--> statement-breakpoint
ALTER TABLE "access_profiles" ADD COLUMN "claude_model" text;--> statement-breakpoint
ALTER TABLE "access_profiles" ADD COLUMN "claude_effort" text;--> statement-breakpoint
ALTER TABLE "access_profiles" ADD COLUMN "openai_part" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "access_profiles" ADD COLUMN "openai_credential_id" uuid;--> statement-breakpoint
ALTER TABLE "access_profiles" ADD COLUMN "openai_gateway_credential_id" uuid;--> statement-breakpoint
ALTER TABLE "access_profiles" ADD COLUMN "openai_model" text;--> statement-breakpoint
ALTER TABLE "access_profiles" ADD COLUMN "openai_effort" text;--> statement-breakpoint
ALTER TABLE "access_profiles" ADD COLUMN "github_credential_id" uuid;--> statement-breakpoint
ALTER TABLE "access_profiles" ADD COLUMN "github_rights" jsonb;--> statement-breakpoint
ALTER TABLE "access_profiles" ADD COLUMN "atlassian_credential_id" uuid;--> statement-breakpoint
ALTER TABLE "access_profiles" ADD COLUMN "atlassian_rights" jsonb;--> statement-breakpoint
ALTER TABLE "access_profiles" ADD CONSTRAINT "access_profiles_claude_credential_id_credentials_id_fk" FOREIGN KEY ("claude_credential_id") REFERENCES "public"."credentials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_profiles" ADD CONSTRAINT "access_profiles_claude_gateway_credential_id_credentials_id_fk" FOREIGN KEY ("claude_gateway_credential_id") REFERENCES "public"."credentials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_profiles" ADD CONSTRAINT "access_profiles_openai_credential_id_credentials_id_fk" FOREIGN KEY ("openai_credential_id") REFERENCES "public"."credentials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_profiles" ADD CONSTRAINT "access_profiles_openai_gateway_credential_id_credentials_id_fk" FOREIGN KEY ("openai_gateway_credential_id") REFERENCES "public"."credentials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_profiles" ADD CONSTRAINT "access_profiles_github_credential_id_credentials_id_fk" FOREIGN KEY ("github_credential_id") REFERENCES "public"."credentials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_profiles" ADD CONSTRAINT "access_profiles_atlassian_credential_id_credentials_id_fk" FOREIGN KEY ("atlassian_credential_id") REFERENCES "public"."credentials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_profiles" ADD CONSTRAINT "access_profiles_claude_check" CHECK ("access_profiles"."claude_part" or ("access_profiles"."claude_credential_id" is null and "access_profiles"."claude_gateway_credential_id" is null and "access_profiles"."claude_model" is null and "access_profiles"."claude_effort" is null));--> statement-breakpoint
ALTER TABLE "access_profiles" ADD CONSTRAINT "access_profiles_claude_model_check" CHECK (char_length("access_profiles"."claude_model") between 1 and 100);--> statement-breakpoint
ALTER TABLE "access_profiles" ADD CONSTRAINT "access_profiles_claude_effort_check" CHECK ("access_profiles"."claude_effort" in ('low', 'medium', 'high', 'xhigh', 'max', 'ultra'));--> statement-breakpoint
ALTER TABLE "access_profiles" ADD CONSTRAINT "access_profiles_openai_check" CHECK ("access_profiles"."openai_part" or ("access_profiles"."openai_credential_id" is null and "access_profiles"."openai_gateway_credential_id" is null and "access_profiles"."openai_model" is null and "access_profiles"."openai_effort" is null));--> statement-breakpoint
ALTER TABLE "access_profiles" ADD CONSTRAINT "access_profiles_openai_model_check" CHECK (char_length("access_profiles"."openai_model") between 1 and 100);--> statement-breakpoint
ALTER TABLE "access_profiles" ADD CONSTRAINT "access_profiles_openai_effort_check" CHECK ("access_profiles"."openai_effort" in ('low', 'medium', 'high', 'xhigh', 'max', 'ultra'));--> statement-breakpoint
ALTER TABLE "access_profiles" ADD CONSTRAINT "access_profiles_github_check" CHECK ("access_profiles"."github_credential_id" is null or "access_profiles"."github_rights" is not null);--> statement-breakpoint
ALTER TABLE "access_profiles" ADD CONSTRAINT "access_profiles_github_rights_check" CHECK (jsonb_typeof("access_profiles"."github_rights") = 'object');--> statement-breakpoint
ALTER TABLE "access_profiles" ADD CONSTRAINT "access_profiles_atlassian_check" CHECK ("access_profiles"."atlassian_credential_id" is null or "access_profiles"."atlassian_rights" is not null);--> statement-breakpoint
ALTER TABLE "access_profiles" ADD CONSTRAINT "access_profiles_atlassian_rights_check" CHECK (jsonb_typeof("access_profiles"."atlassian_rights") = 'object');
--> statement-breakpoint
-- custom: the data step, which drizzle-kit does not write. It runs after the new columns above and before the old ones
-- go below (drizzle-kit wrote those statements as a second step, joined into this file so the change is one migration).
-- Until now a profile had one provider (Claude, OpenAI, or since `0030_tool_profiles` GitHub or Atlassian) and an agent
-- had a GitHub and an Atlassian profile beside its access profile; since 2026-11-13 (Ihor: "GENERIC profile, which has
-- under the hood, assigning Claude/GH/Jira etc.") a profile is a name and optional parts, and an agent has one profile.
--   Every profile keeps its id, name and owner and gets the one part its provider was, with that provider's columns
--   (a Claude or OpenAI profile: its subscription, gateway, model and effort; a GitHub or Atlassian profile: its sign-in
--   and rights). Nothing is deleted.
--   An agent's GitHub or Atlassian profile is also copied into the agent's profile as its part of that tool, only when
--   that keeps everyone's access as it was: the migration refuses (and changes nothing) when an agent has a tool
--   profile but no profile to copy it into, when the tool profile is another person's than the agent's profile, or when
--   the agents on one profile do not all have the same GitHub profile (or the same Atlassian profile; none counts as
--   one). Each refusal names what to fix.
-- The audit log gets each profile's provider going (it is now its part), each part copied in and each agent's tool
-- profile taken off, by the system, with the request id `migration:0032_generic_profiles`.
DO $$
DECLARE
	problem record;
BEGIN
	SELECT "a"."name", "a"."id" INTO problem
	FROM "agents" "a"
	WHERE "a"."profile_id" IS NULL AND ("a"."github_profile_id" IS NOT NULL OR "a"."atlassian_profile_id" IS NOT NULL)
	ORDER BY "a"."created_at", "a"."id"
	LIMIT 1;
	IF FOUND THEN
		RAISE EXCEPTION 'migration 0032_generic_profiles: the agent "%" (%) has a GitHub or Atlassian profile but no access profile to copy it into', problem."name", problem."id"
			USING HINT = 'Give the agent an access profile or take its GitHub and Atlassian profiles off, then migrate again.';
	END IF;
	SELECT "a"."name", "a"."id", "p"."name" AS "profile" INTO problem
	FROM "agents" "a"
	JOIN "access_profiles" "p" ON "p"."id" = "a"."profile_id"
	JOIN "access_profiles" "t" ON "t"."id" IN ("a"."github_profile_id", "a"."atlassian_profile_id")
	WHERE "t"."owner_user_id" <> "p"."owner_user_id"
	ORDER BY "a"."created_at", "a"."id"
	LIMIT 1;
	IF FOUND THEN
		RAISE EXCEPTION 'migration 0032_generic_profiles: the agent "%" (%) has a GitHub or Atlassian profile of another person than its access profile "%"', problem."name", problem."id", problem."profile"
			USING HINT = 'A profile holds only its owner''s sign-ins: give the agent tool profiles of its access profile''s owner, or none, then migrate again.';
	END IF;
	SELECT "p"."name", "p"."id" INTO problem
	FROM "access_profiles" "p"
	JOIN "agents" "a" ON "a"."profile_id" = "p"."id"
	GROUP BY "p"."id", "p"."name", "p"."created_at"
	HAVING count(DISTINCT coalesce("a"."github_profile_id"::text, '')) > 1
		OR count(DISTINCT coalesce("a"."atlassian_profile_id"::text, '')) > 1
	ORDER BY "p"."created_at", "p"."id"
	LIMIT 1;
	IF FOUND THEN
		RAISE EXCEPTION 'migration 0032_generic_profiles: the agents on the access profile "%" (%) do not all have the same GitHub and Atlassian profiles', problem."name", problem."id"
			USING HINT = 'Give every agent on that access profile the same GitHub profile and the same Atlassian profile (or none), or move some to another access profile, then migrate again.';
	END IF;
END $$;
--> statement-breakpoint
UPDATE "access_profiles" SET "claude_part" = true, "claude_credential_id" = "credential_id",
	"claude_gateway_credential_id" = "gateway_credential_id", "claude_model" = "model", "claude_effort" = "effort"
WHERE "provider" = 'claude';
--> statement-breakpoint
UPDATE "access_profiles" SET "openai_part" = true, "openai_credential_id" = "credential_id",
	"openai_gateway_credential_id" = "gateway_credential_id", "openai_model" = "model", "openai_effort" = "effort"
WHERE "provider" = 'openai';
--> statement-breakpoint
UPDATE "access_profiles" SET "github_credential_id" = "credential_id", "github_rights" = "rights"
WHERE "provider" = 'github';
--> statement-breakpoint
UPDATE "access_profiles" SET "atlassian_credential_id" = "credential_id", "atlassian_rights" = "rights"
WHERE "provider" = 'atlassian';
--> statement-breakpoint
INSERT INTO "audit_log" ("actor_kind", "entity_type", "entity_id", "action", "field", "old_value", "request_id")
SELECT 'system', 'access_profile', "id"::text, 'update', 'provider', to_jsonb("provider"),
	'migration:0032_generic_profiles'
FROM "access_profiles";
--> statement-breakpoint
WITH "folds" AS (
	SELECT DISTINCT "profile_id", "github_profile_id" FROM "agents" WHERE "github_profile_id" IS NOT NULL
),
"set" AS (
	UPDATE "access_profiles" "p" SET "github_credential_id" = "t"."credential_id", "github_rights" = "t"."rights"
	FROM "folds" "f"
	JOIN "access_profiles" "t" ON "t"."id" = "f"."github_profile_id"
	WHERE "p"."id" = "f"."profile_id"
	RETURNING "p"."id", "p"."github_credential_id", "p"."github_rights"
)
INSERT INTO "audit_log" ("actor_kind", "entity_type", "entity_id", "action", "field", "new_value", "request_id")
SELECT 'system', 'access_profile', "id"::text, 'update', 'githubCredentialId', to_jsonb("github_credential_id"::text),
	'migration:0032_generic_profiles'
FROM "set"
WHERE "github_credential_id" IS NOT NULL
UNION ALL
SELECT 'system', 'access_profile', "id"::text, 'update', 'githubRights', "github_rights", 'migration:0032_generic_profiles'
FROM "set";
--> statement-breakpoint
WITH "folds" AS (
	SELECT DISTINCT "profile_id", "atlassian_profile_id" FROM "agents" WHERE "atlassian_profile_id" IS NOT NULL
),
"set" AS (
	UPDATE "access_profiles" "p" SET "atlassian_credential_id" = "t"."credential_id", "atlassian_rights" = "t"."rights"
	FROM "folds" "f"
	JOIN "access_profiles" "t" ON "t"."id" = "f"."atlassian_profile_id"
	WHERE "p"."id" = "f"."profile_id"
	RETURNING "p"."id", "p"."atlassian_credential_id", "p"."atlassian_rights"
)
INSERT INTO "audit_log" ("actor_kind", "entity_type", "entity_id", "action", "field", "new_value", "request_id")
SELECT 'system', 'access_profile', "id"::text, 'update', 'atlassianCredentialId',
	to_jsonb("atlassian_credential_id"::text), 'migration:0032_generic_profiles'
FROM "set"
WHERE "atlassian_credential_id" IS NOT NULL
UNION ALL
SELECT 'system', 'access_profile', "id"::text, 'update', 'atlassianRights', "atlassian_rights",
	'migration:0032_generic_profiles'
FROM "set";
--> statement-breakpoint
INSERT INTO "audit_log"
	("company_id", "actor_kind", "entity_type", "entity_id", "action", "field", "old_value", "request_id")
SELECT "company_id", 'system', 'agent', "id"::text, 'update', 'githubProfileId', to_jsonb("github_profile_id"::text),
	'migration:0032_generic_profiles'
FROM "agents"
WHERE "github_profile_id" IS NOT NULL
UNION ALL
SELECT "company_id", 'system', 'agent', "id"::text, 'update', 'atlassianProfileId',
	to_jsonb("atlassian_profile_id"::text), 'migration:0032_generic_profiles'
FROM "agents"
WHERE "atlassian_profile_id" IS NOT NULL;
--> statement-breakpoint
-- The second step drizzle-kit wrote: the provider and its columns, the rights and the agents' tool profiles go.
ALTER TABLE "access_profiles" DROP CONSTRAINT "access_profiles_provider_check";--> statement-breakpoint
ALTER TABLE "access_profiles" DROP CONSTRAINT "access_profiles_model_check";--> statement-breakpoint
ALTER TABLE "access_profiles" DROP CONSTRAINT "access_profiles_effort_check";--> statement-breakpoint
ALTER TABLE "access_profiles" DROP CONSTRAINT "access_profiles_rights_check";--> statement-breakpoint
ALTER TABLE "access_profiles" DROP CONSTRAINT "access_profiles_rights_object_check";--> statement-breakpoint
ALTER TABLE "access_profiles" DROP CONSTRAINT "access_profiles_tool_check";--> statement-breakpoint
ALTER TABLE "access_profiles" DROP CONSTRAINT "access_profiles_credential_id_credentials_id_fk";
--> statement-breakpoint
ALTER TABLE "access_profiles" DROP CONSTRAINT "access_profiles_gateway_credential_id_credentials_id_fk";
--> statement-breakpoint
ALTER TABLE "agents" DROP CONSTRAINT "agents_github_profile_id_access_profiles_id_fk";
--> statement-breakpoint
ALTER TABLE "agents" DROP CONSTRAINT "agents_atlassian_profile_id_access_profiles_id_fk";
--> statement-breakpoint
DROP INDEX "agents_github_profile_idx";--> statement-breakpoint
DROP INDEX "agents_atlassian_profile_idx";--> statement-breakpoint
ALTER TABLE "access_profiles" DROP COLUMN "provider";--> statement-breakpoint
ALTER TABLE "access_profiles" DROP COLUMN "credential_id";--> statement-breakpoint
ALTER TABLE "access_profiles" DROP COLUMN "gateway_credential_id";--> statement-breakpoint
ALTER TABLE "access_profiles" DROP COLUMN "model";--> statement-breakpoint
ALTER TABLE "access_profiles" DROP COLUMN "effort";--> statement-breakpoint
ALTER TABLE "access_profiles" DROP COLUMN "rights";--> statement-breakpoint
ALTER TABLE "agents" DROP COLUMN "github_profile_id";--> statement-breakpoint
ALTER TABLE "agents" DROP COLUMN "atlassian_profile_id";
