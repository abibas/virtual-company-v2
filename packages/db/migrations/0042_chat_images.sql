CREATE TABLE "chat_images" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"chat_id" uuid NOT NULL,
	"turn_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"content_type" text NOT NULL,
	"bytes" "bytea" NOT NULL,
	"size" integer NOT NULL,
	"sha256" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_images_company_id_id_unique" UNIQUE("company_id","id"),
	CONSTRAINT "chat_images_turn_position_unique" UNIQUE("company_id","turn_id","position"),
	CONSTRAINT "chat_images_position_check" CHECK ("chat_images"."position" between 0 and 5),
	CONSTRAINT "chat_images_content_type_check" CHECK ("chat_images"."content_type" in ('image/png', 'image/jpeg', 'image/webp', 'image/gif')),
	CONSTRAINT "chat_images_size_check" CHECK ("chat_images"."size" between 1 and 3145728 and octet_length("chat_images"."bytes") = "chat_images"."size"),
	CONSTRAINT "chat_images_sha256_check" CHECK ("chat_images"."sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "chat_turns" ADD COLUMN "images" jsonb;--> statement-breakpoint
ALTER TABLE "chat_images" ADD CONSTRAINT "chat_images_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_images" ADD CONSTRAINT "chat_images_chat_fk" FOREIGN KEY ("company_id","chat_id") REFERENCES "public"."chats"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_images" ADD CONSTRAINT "chat_images_turn_fk" FOREIGN KEY ("company_id","turn_id") REFERENCES "public"."chat_turns"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_images" ADD CONSTRAINT "chat_images_created_by_fk" FOREIGN KEY ("company_id","created_by") REFERENCES "public"."principals"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_turns" ADD CONSTRAINT "chat_turns_images_check" CHECK ("chat_turns"."images" is null or ("chat_turns"."kind" = 'message' and jsonb_typeof("chat_turns"."images") = 'array'));