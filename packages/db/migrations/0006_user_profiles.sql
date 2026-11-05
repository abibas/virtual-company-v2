ALTER TABLE "users" ALTER COLUMN "display_name" DROP NOT NULL;--> statement-breakpoint
-- custom: a data step, which drizzle-kit does not write. Until now a person without a first or last name got the
-- display name Clerk would show instead, the part of their email before the @ (or a blank one), which the web then
-- took for a name. A display name is now only the person's own name, null until they give one (the web asks for
-- it), so those stand-ins are cleared. The next sync of a person who has a name writes it again.
UPDATE "users" SET "display_name" = NULL
WHERE btrim("display_name") = '' OR "display_name" = split_part("primary_email", '@', 1);
