-- custom: the guard, which drizzle-kit does not write, put before its statement so a profile with both AI parts gets a
-- clear refusal instead of the CHECK's own error. Since 2026-11-13 (Ihor: "we have to LOCK in Profile, that we can
-- Choose EITHER 1 harness EITHER 2nd one... NOT BOTH simultaneously!") a profile has a Claude part or an OpenAI part, not
-- both, and an agent's harness follows it. No profile had both when this was written; the migration refuses, changing
-- nothing, when one does, naming it.
DO $$
DECLARE
	problem record;
BEGIN
	SELECT "p"."name", "p"."id" INTO problem
	FROM "access_profiles" "p"
	WHERE "p"."claude_part" AND "p"."openai_part"
	ORDER BY "p"."created_at", "p"."id"
	LIMIT 1;
	IF FOUND THEN
		RAISE EXCEPTION 'migration 0033_one_ai_part: the profile "%" (%) has both a Claude part and an OpenAI part', problem."name", problem."id"
			USING HINT = 'A profile runs one AI: remove one of its two AI parts (or move it to a new profile), then migrate again.';
	END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "access_profiles" ADD CONSTRAINT "access_profiles_one_ai_part_check" CHECK (not ("access_profiles"."claude_part" and "access_profiles"."openai_part"));