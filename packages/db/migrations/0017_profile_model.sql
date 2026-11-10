ALTER TABLE "agents" DROP CONSTRAINT "agents_effort_check";--> statement-breakpoint
ALTER TABLE "access_profiles" ADD COLUMN "model" text;--> statement-breakpoint
ALTER TABLE "access_profiles" ADD COLUMN "effort" text;--> statement-breakpoint
ALTER TABLE "access_profiles" ADD CONSTRAINT "access_profiles_model_check" CHECK (char_length("access_profiles"."model") between 1 and 100);--> statement-breakpoint
ALTER TABLE "access_profiles" ADD CONSTRAINT "access_profiles_effort_check" CHECK ("access_profiles"."effort" in ('low', 'medium', 'high', 'xhigh', 'max', 'ultra'));
--> statement-breakpoint
-- custom: the data step, which drizzle-kit does not write. It runs after the new columns above and before the agents'
-- columns go below (drizzle-kit wrote those statements as a second step, joined into this file so the change is one
-- migration). Until now each agent had a model and an effort; now its access profile has them. Each profile takes the
-- model most used by the agents that have it (archived ones too), and the effort most used by them, a tie going to the
-- newest agent's; the model is null (the provider's default) when it is Codex's own default marker `codex-default`,
-- or a model of the other provider than the profile's (a Claude id or alias on an OpenAI profile, a GPT, o-series or
-- Codex id on a Claude one, as `modelProvider` of `@mwc/shared/models` tells them). A profile no agent uses keeps both
-- null. The audit log gets each value set, by the system, with the request id `migration:0017_profile_model`.
WITH "ranked" AS (
	SELECT "profile_id", "model", "effort", "created_at", "id",
		count(*) OVER (PARTITION BY "profile_id", "model") AS "model_uses",
		count(*) OVER (PARTITION BY "profile_id", "effort") AS "effort_uses"
	FROM "agents"
	WHERE "profile_id" IS NOT NULL
),
"models" AS (
	SELECT DISTINCT ON ("profile_id") "profile_id", "model"
	FROM "ranked"
	ORDER BY "profile_id", "model_uses" DESC, "created_at" DESC, "id" DESC
),
"efforts" AS (
	SELECT DISTINCT ON ("profile_id") "profile_id", "effort"
	FROM "ranked"
	ORDER BY "profile_id", "effort_uses" DESC, "created_at" DESC, "id" DESC
),
"chosen" AS (
	SELECT "p"."id", "e"."effort",
		CASE
			WHEN "m"."model" = 'codex-default' THEN NULL
			WHEN "p"."provider" = 'openai' AND lower("m"."model") ~ '^(claude|opus|sonnet|haiku|fable)' THEN NULL
			WHEN "p"."provider" = 'claude' AND lower("m"."model") ~ '^(gpt-|o[0-9]|codex-)' THEN NULL
			ELSE "m"."model"
		END AS "model"
	FROM "access_profiles" "p"
	JOIN "models" "m" ON "m"."profile_id" = "p"."id"
	JOIN "efforts" "e" ON "e"."profile_id" = "p"."id"
),
"set" AS (
	UPDATE "access_profiles" SET "model" = "chosen"."model", "effort" = "chosen"."effort"
	FROM "chosen"
	WHERE "chosen"."id" = "access_profiles"."id"
	RETURNING "access_profiles"."id", "access_profiles"."model", "access_profiles"."effort"
)
INSERT INTO "audit_log" ("actor_kind", "entity_type", "entity_id", "action", "field", "new_value", "request_id")
SELECT 'system', 'access_profile', "id"::text, 'update', 'model', to_jsonb("model"), 'migration:0017_profile_model'
FROM "set"
WHERE "model" IS NOT NULL
UNION ALL
SELECT 'system', 'access_profile', "id"::text, 'update', 'effort', to_jsonb("effort"), 'migration:0017_profile_model'
FROM "set";
--> statement-breakpoint
-- The second step drizzle-kit wrote: the agents' model and effort go.
ALTER TABLE "agents" DROP COLUMN "model";--> statement-breakpoint
ALTER TABLE "agents" DROP COLUMN "effort";