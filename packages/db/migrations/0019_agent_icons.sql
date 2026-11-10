CREATE TABLE "agent_icons" (
	"company_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"content_type" text NOT NULL,
	"bytes" "bytea" NOT NULL,
	"size" integer NOT NULL,
	"sha256" text NOT NULL,
	"updated_by_principal_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_icons_pkey" PRIMARY KEY("company_id","agent_id"),
	CONSTRAINT "agent_icons_content_type_check" CHECK ("agent_icons"."content_type" in ('image/png', 'image/jpeg', 'image/webp', 'image/gif')),
	CONSTRAINT "agent_icons_size_check" CHECK ("agent_icons"."size" between 1 and 1048576),
	CONSTRAINT "agent_icons_sha256_check" CHECK ("agent_icons"."sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "icon_kind" text DEFAULT 'face' NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "icon_emoji" text;--> statement-breakpoint
ALTER TABLE "agent_icons" ADD CONSTRAINT "agent_icons_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_icons" ADD CONSTRAINT "agent_icons_agent_fk" FOREIGN KEY ("company_id","agent_id") REFERENCES "public"."agents"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_icons" ADD CONSTRAINT "agent_icons_updated_by_principal_fk" FOREIGN KEY ("company_id","updated_by_principal_id") REFERENCES "public"."principals"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_icon_kind_check" CHECK ("agents"."icon_kind" in ('face', 'emoji', 'image'));--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_icon_emoji_kind_check" CHECK (("agents"."icon_kind" = 'emoji') = ("agents"."icon_emoji" is not null));--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_icon_emoji_check" CHECK (char_length("agents"."icon_emoji") between 1 and 16);