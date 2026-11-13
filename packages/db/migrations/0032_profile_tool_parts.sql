ALTER TABLE "access_profiles" ADD COLUMN "github_credential_id" uuid;--> statement-breakpoint
ALTER TABLE "access_profiles" ADD COLUMN "github_rights" jsonb;--> statement-breakpoint
ALTER TABLE "access_profiles" ADD COLUMN "atlassian_credential_id" uuid;--> statement-breakpoint
ALTER TABLE "access_profiles" ADD COLUMN "atlassian_rights" jsonb;--> statement-breakpoint
ALTER TABLE "access_profiles" ADD CONSTRAINT "access_profiles_github_credential_id_credentials_id_fk" FOREIGN KEY ("github_credential_id") REFERENCES "public"."credentials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_profiles" ADD CONSTRAINT "access_profiles_atlassian_credential_id_credentials_id_fk" FOREIGN KEY ("atlassian_credential_id") REFERENCES "public"."credentials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_profiles" ADD CONSTRAINT "access_profiles_github_check" CHECK ("access_profiles"."github_credential_id" is null or "access_profiles"."github_rights" is not null);--> statement-breakpoint
ALTER TABLE "access_profiles" ADD CONSTRAINT "access_profiles_github_rights_check" CHECK (jsonb_typeof("access_profiles"."github_rights") = 'object');--> statement-breakpoint
ALTER TABLE "access_profiles" ADD CONSTRAINT "access_profiles_atlassian_check" CHECK ("access_profiles"."atlassian_credential_id" is null or "access_profiles"."atlassian_rights" is not null);--> statement-breakpoint
ALTER TABLE "access_profiles" ADD CONSTRAINT "access_profiles_atlassian_rights_check" CHECK (jsonb_typeof("access_profiles"."atlassian_rights") = 'object');
--> statement-breakpoint
-- custom: the data step, which drizzle-kit does not write. It runs after the new columns above and before the tool
-- profiles' columns go below (drizzle-kit wrote those statements as a second step, joined into this file so the change
-- is one migration). Until now GitHub and Atlassian were profiles of their own (S7.1b, migration `0030_tool_profiles`),
-- given to an agent beside its access profile (`agents.github_profile_id`, `atlassian_profile_id`); since 2026-11-13
-- (Ihor: "a SINGLE profile ... with sub accesses to the tooling") they are parts of the access profile itself.
--   A tool profile no agent uses is deleted; its sign-in stays where it is.
--   A tool profile an agent uses is folded into that agent's access profile: its sign-in and rights become the
--   profile's GitHub or Atlassian part. That is done only when it keeps everyone's access as it was, so the
--   migration refuses (and changes nothing) when an agent has a tool profile but no access profile, when the tool
--   profile is someone else's than the access profile, or when the agents on one access profile do not all have the
--   same GitHub profile (or the same Atlassian profile; none counts as one). Each refusal names what to fix.
-- Then every tool profile goes. The audit log gets each part folded in, each agent's tool profile taken off and each
-- tool profile deleted, by the system, with the request id `migration:0032_profile_tool_parts`.
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
		RAISE EXCEPTION 'migration 0032_profile_tool_parts: the agent "%" (%) has a GitHub or Atlassian profile but no access profile to fold it into', problem."name", problem."id"
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
		RAISE EXCEPTION 'migration 0032_profile_tool_parts: the agent "%" (%) has a GitHub or Atlassian profile of another person than its access profile "%"', problem."name", problem."id", problem."profile"
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
		RAISE EXCEPTION 'migration 0032_profile_tool_parts: the agents on the access profile "%" (%) do not all have the same GitHub and Atlassian profiles', problem."name", problem."id"
			USING HINT = 'Give every agent on that access profile the same GitHub profile and the same Atlassian profile (or none), or move some to another access profile, then migrate again.';
	END IF;
END $$;
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
	'migration:0032_profile_tool_parts'
FROM "set"
WHERE "github_credential_id" IS NOT NULL
UNION ALL
SELECT 'system', 'access_profile', "id"::text, 'update', 'githubRights', "github_rights", 'migration:0032_profile_tool_parts'
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
	to_jsonb("atlassian_credential_id"::text), 'migration:0032_profile_tool_parts'
FROM "set"
WHERE "atlassian_credential_id" IS NOT NULL
UNION ALL
SELECT 'system', 'access_profile', "id"::text, 'update', 'atlassianRights', "atlassian_rights",
	'migration:0032_profile_tool_parts'
FROM "set";
--> statement-breakpoint
INSERT INTO "audit_log"
	("company_id", "actor_kind", "entity_type", "entity_id", "action", "field", "old_value", "request_id")
SELECT "company_id", 'system', 'agent', "id"::text, 'update', 'githubProfileId', to_jsonb("github_profile_id"::text),
	'migration:0032_profile_tool_parts'
FROM "agents"
WHERE "github_profile_id" IS NOT NULL
UNION ALL
SELECT "company_id", 'system', 'agent', "id"::text, 'update', 'atlassianProfileId',
	to_jsonb("atlassian_profile_id"::text), 'migration:0032_profile_tool_parts'
FROM "agents"
WHERE "atlassian_profile_id" IS NOT NULL;
--> statement-breakpoint
WITH "gone" AS (
	DELETE FROM "access_profiles" WHERE "provider" IN ('github', 'atlassian')
	RETURNING "id", "owner_user_id", "name", "provider", "credential_id", "rights"
)
INSERT INTO "audit_log" ("actor_kind", "entity_type", "entity_id", "action", "field", "old_value", "request_id")
SELECT 'system', 'access_profile', "id"::text, 'delete', "field", "value", 'migration:0032_profile_tool_parts'
FROM "gone",
	LATERAL (VALUES
		('credentialId', to_jsonb("credential_id"::text)),
		('name', to_jsonb("name")),
		('ownerUserId', to_jsonb("owner_user_id"::text)),
		('provider', to_jsonb("provider")),
		('rights', "rights")
	) AS "fields" ("field", "value")
WHERE "value" IS NOT NULL;
--> statement-breakpoint
-- The second step drizzle-kit wrote: the tool profiles' columns and CHECKs go, and a profile's provider is an AI one.
ALTER TABLE "access_profiles" DROP CONSTRAINT "access_profiles_rights_check";--> statement-breakpoint
ALTER TABLE "access_profiles" DROP CONSTRAINT "access_profiles_rights_object_check";--> statement-breakpoint
ALTER TABLE "access_profiles" DROP CONSTRAINT "access_profiles_tool_check";--> statement-breakpoint
ALTER TABLE "access_profiles" DROP CONSTRAINT "access_profiles_provider_check";--> statement-breakpoint
ALTER TABLE "agents" DROP CONSTRAINT "agents_github_profile_id_access_profiles_id_fk";
--> statement-breakpoint
ALTER TABLE "agents" DROP CONSTRAINT "agents_atlassian_profile_id_access_profiles_id_fk";
--> statement-breakpoint
DROP INDEX "agents_github_profile_idx";--> statement-breakpoint
DROP INDEX "agents_atlassian_profile_idx";--> statement-breakpoint
ALTER TABLE "access_profiles" DROP COLUMN "rights";--> statement-breakpoint
ALTER TABLE "agents" DROP COLUMN "github_profile_id";--> statement-breakpoint
ALTER TABLE "agents" DROP COLUMN "atlassian_profile_id";--> statement-breakpoint
ALTER TABLE "access_profiles" ADD CONSTRAINT "access_profiles_provider_check" CHECK ("access_profiles"."provider" in ('claude', 'openai'));
