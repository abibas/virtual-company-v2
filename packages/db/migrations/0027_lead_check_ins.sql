ALTER TABLE "lead_wake_events" DROP CONSTRAINT "lead_wake_events_kind_check";--> statement-breakpoint
ALTER TABLE "flows" ALTER COLUMN "wake_max_per_hour" SET DEFAULT 12;--> statement-breakpoint
ALTER TABLE "flows" ALTER COLUMN "wake_max_per_day" SET DEFAULT 150;--> statement-breakpoint
ALTER TABLE "lead_wake_events" ALTER COLUMN "task_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "flows" ADD COLUMN "wake_check_in_minutes" integer DEFAULT 5;--> statement-breakpoint
ALTER TABLE "flows" ADD CONSTRAINT "flows_wake_check_in_check" CHECK ("flows"."wake_check_in_minutes" is null or "flows"."wake_check_in_minutes" between 3 and 60);--> statement-breakpoint
ALTER TABLE "lead_wake_events" ADD CONSTRAINT "lead_wake_events_task_check" CHECK (("lead_wake_events"."kind" = 'check_in') = ("lead_wake_events"."task_id" is null));--> statement-breakpoint
ALTER TABLE "lead_wake_events" ADD CONSTRAINT "lead_wake_events_kind_check" CHECK ("lead_wake_events"."kind" in ('escalated', 'blocked', 'turn_ended', 'done', 'signoff_waiting', 'check_in'));--> statement-breakpoint
-- custom: the data step, which drizzle-kit does not write. A flow's check-ins count toward its caps on wake-ups, and a
-- check-in every 5 minutes makes twelve an hour; so the caps' defaults rose from 6 an hour and 40 a day to 12 and 150.
-- A flow still at an old default takes the new one (a cap set to anything else keeps it). The audit log gets each value
-- changed on the flow, by the system, with the request id `migration:0027_lead_check_ins`.
WITH "old" AS (
	SELECT "company_id", "id", "wake_max_per_hour" AS "hour", "wake_max_per_day" AS "day"
	FROM "flows"
	WHERE "wake_max_per_hour" = 6 OR "wake_max_per_day" = 40
),
"set" AS (
	UPDATE "flows" SET
		"wake_max_per_hour" = CASE WHEN "old"."hour" = 6 THEN 12 ELSE "old"."hour" END,
		"wake_max_per_day" = CASE WHEN "old"."day" = 40 THEN 150 ELSE "old"."day" END
	FROM "old"
	WHERE "old"."company_id" = "flows"."company_id" AND "old"."id" = "flows"."id"
	RETURNING "old"."company_id", "old"."id", "old"."hour", "old"."day"
)
INSERT INTO "audit_log" ("company_id", "actor_kind", "entity_type", "entity_id", "action", "field", "old_value", "new_value", "request_id")
SELECT "company_id", 'system', 'flow', "id"::text, 'update', 'wakeMaxPerHour', to_jsonb(6), to_jsonb(12), 'migration:0027_lead_check_ins'
FROM "set"
WHERE "hour" = 6
UNION ALL
SELECT "company_id", 'system', 'flow', "id"::text, 'update', 'wakeMaxPerDay', to_jsonb(40), to_jsonb(150), 'migration:0027_lead_check_ins'
FROM "set"
WHERE "day" = 40;
