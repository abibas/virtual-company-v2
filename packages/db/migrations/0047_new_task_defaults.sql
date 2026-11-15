ALTER TABLE "flows" ADD COLUMN "new_task_step_id" uuid;--> statement-breakpoint
ALTER TABLE "flows" ADD COLUMN "new_task_auto_take" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "flows" ADD CONSTRAINT "flows_new_task_step_fk" FOREIGN KEY ("company_id","new_task_step_id") REFERENCES "public"."flow_steps"("company_id","id") ON DELETE no action ON UPDATE no action;