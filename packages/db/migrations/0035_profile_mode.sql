ALTER TABLE "access_profiles" DROP CONSTRAINT "access_profiles_claude_check";--> statement-breakpoint
ALTER TABLE "access_profiles" DROP CONSTRAINT "access_profiles_openai_check";--> statement-breakpoint
ALTER TABLE "agent_placements" DROP CONSTRAINT "agent_placements_permission_policy_check";--> statement-breakpoint
ALTER TABLE "chat_turns" ADD COLUMN "mode" text;--> statement-breakpoint
ALTER TABLE "chat_turns" ADD COLUMN "model" text;--> statement-breakpoint
ALTER TABLE "chat_turns" ADD COLUMN "effort" text;--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "mode" text;--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "model" text;--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "effort" text;--> statement-breakpoint
ALTER TABLE "access_profiles" ADD COLUMN "claude_mode" text;--> statement-breakpoint
ALTER TABLE "access_profiles" ADD COLUMN "openai_mode" text;
--> statement-breakpoint
-- custom: the data step, which drizzle-kit does not write. It runs after the profiles' mode columns above and before the
-- placements' `permission_policy` goes below (drizzle-kit wrote both in one file; the data step sits before its drop, as
-- 0017's does). Since 2026-11-13 (Ihor: "I would love to set it in the PROFILE, with an ability to change in the CHAT")
-- an AI part's mode says whether its turns ask before a tool, not the agent's placement. Each profile with an AI part
-- takes its mode from the agents that run on it now (not archived, with a placement): Skip prompts
-- (`bypassPermissions`) on a Claude part, Full trust (`full`) on an OpenAI part, when every one of them had `bypass`;
-- else (all `ask`, or they differ) Manual (`manual`) or Ask (`ask`). A profile no such agent uses keeps the default
-- (null: Manual or Ask). A profile whose agents differed is named in a notice with its agents and their settings. The
-- audit log gets each mode set, by the system, with the request id `migration:0035_profile_mode`.
DO $$
DECLARE
	differ record;
BEGIN
	FOR differ IN
		SELECT "p"."name", "p"."id",
			string_agg("a"."name" || ' (' || "pl"."permission_policy" || ')', ', ' ORDER BY "a"."name") AS "agents"
		FROM "access_profiles" "p"
		JOIN "agents" "a" ON "a"."profile_id" = "p"."id"
		JOIN "agent_placements" "pl"
			ON "pl"."company_id" = "a"."company_id" AND "pl"."agent_id" = "a"."id" AND "pl"."is_default"
		WHERE "a"."status" <> 'archived' AND ("p"."claude_part" OR "p"."openai_part")
		GROUP BY "p"."id", "p"."name"
		HAVING count(DISTINCT "pl"."permission_policy") > 1
		ORDER BY "p"."name", "p"."id"
	LOOP
		RAISE NOTICE 'migration 0035_profile_mode: the profile "%" (%) runs in Manual or Ask: its agents differed: %',
			differ."name", differ."id", differ."agents";
	END LOOP;
END $$;
--> statement-breakpoint
WITH "settings" AS (
	SELECT "a"."profile_id", bool_and("pl"."permission_policy" = 'bypass') AS "all_bypass"
	FROM "agents" "a"
	JOIN "agent_placements" "pl"
		ON "pl"."company_id" = "a"."company_id" AND "pl"."agent_id" = "a"."id" AND "pl"."is_default"
	WHERE "a"."profile_id" IS NOT NULL AND "a"."status" <> 'archived'
	GROUP BY "a"."profile_id"
),
"set" AS (
	UPDATE "access_profiles" SET
		"claude_mode" = CASE
			WHEN NOT "access_profiles"."claude_part" THEN NULL
			WHEN "settings"."all_bypass" THEN 'bypassPermissions'
			ELSE 'manual'
		END,
		"openai_mode" = CASE
			WHEN NOT "access_profiles"."openai_part" THEN NULL
			WHEN "settings"."all_bypass" THEN 'full'
			ELSE 'ask'
		END
	FROM "settings"
	WHERE "settings"."profile_id" = "access_profiles"."id"
		AND ("access_profiles"."claude_part" OR "access_profiles"."openai_part")
	RETURNING "access_profiles"."id", "access_profiles"."claude_mode", "access_profiles"."openai_mode"
)
INSERT INTO "audit_log" ("actor_kind", "entity_type", "entity_id", "action", "field", "new_value", "request_id")
SELECT 'system', 'access_profile', "id"::text, 'update', 'claudeMode', to_jsonb("claude_mode"), 'migration:0035_profile_mode'
FROM "set"
WHERE "claude_mode" IS NOT NULL
UNION ALL
SELECT 'system', 'access_profile', "id"::text, 'update', 'openaiMode', to_jsonb("openai_mode"), 'migration:0035_profile_mode'
FROM "set"
WHERE "openai_mode" IS NOT NULL;
--> statement-breakpoint
-- The rest drizzle-kit wrote: the placements' setting goes, then the new CHECKs.
ALTER TABLE "agent_placements" DROP COLUMN "permission_policy";--> statement-breakpoint
ALTER TABLE "chat_turns" ADD CONSTRAINT "chat_turns_mode_check" CHECK ("chat_turns"."mode" in ('manual', 'acceptEdits', 'plan', 'auto', 'bypassPermissions', 'ask', 'full'));--> statement-breakpoint
ALTER TABLE "chat_turns" ADD CONSTRAINT "chat_turns_model_check" CHECK (char_length("chat_turns"."model") between 1 and 100);--> statement-breakpoint
ALTER TABLE "chat_turns" ADD CONSTRAINT "chat_turns_effort_check" CHECK ("chat_turns"."effort" in ('low', 'medium', 'high', 'xhigh', 'max', 'ultra'));--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_mode_check" CHECK ("chats"."mode" in ('manual', 'acceptEdits', 'plan', 'auto', 'bypassPermissions', 'ask', 'full'));--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_model_check" CHECK (char_length("chats"."model") between 1 and 100);--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_effort_check" CHECK ("chats"."effort" in ('low', 'medium', 'high', 'xhigh', 'max', 'ultra'));--> statement-breakpoint
ALTER TABLE "access_profiles" ADD CONSTRAINT "access_profiles_claude_mode_check" CHECK ("access_profiles"."claude_mode" in ('manual', 'acceptEdits', 'plan', 'auto', 'bypassPermissions'));--> statement-breakpoint
ALTER TABLE "access_profiles" ADD CONSTRAINT "access_profiles_openai_mode_check" CHECK ("access_profiles"."openai_mode" in ('ask', 'auto', 'full'));--> statement-breakpoint
ALTER TABLE "access_profiles" ADD CONSTRAINT "access_profiles_claude_check" CHECK ("access_profiles"."claude_part" or ("access_profiles"."claude_credential_id" is null and "access_profiles"."claude_gateway_credential_id" is null and "access_profiles"."claude_model" is null and "access_profiles"."claude_effort" is null and "access_profiles"."claude_mode" is null));--> statement-breakpoint
ALTER TABLE "access_profiles" ADD CONSTRAINT "access_profiles_openai_check" CHECK ("access_profiles"."openai_part" or ("access_profiles"."openai_credential_id" is null and "access_profiles"."openai_gateway_credential_id" is null and "access_profiles"."openai_model" is null and "access_profiles"."openai_effort" is null and "access_profiles"."openai_mode" is null));