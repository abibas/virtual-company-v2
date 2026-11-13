CREATE TABLE "slack_connections" (
	"credential_id" uuid PRIMARY KEY NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"app_key_version" integer,
	"app_iv" "bytea",
	"app_auth_tag" "bytea",
	"app_ciphertext" "bytea",
	"inbound" boolean DEFAULT false NOT NULL,
	"wake" text DEFAULT 'listed' NOT NULL,
	"people" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"default_company_id" uuid,
	"default_agent_id" uuid,
	"max_per_hour" integer DEFAULT 30 NOT NULL,
	"status" text DEFAULT 'off' NOT NULL,
	"status_message" text,
	"status_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "slack_connections_app_token_check" CHECK (("slack_connections"."app_key_version" is null) = ("slack_connections"."app_ciphertext" is null) and ("slack_connections"."app_iv" is null) = ("slack_connections"."app_ciphertext" is null) and ("slack_connections"."app_auth_tag" is null) = ("slack_connections"."app_ciphertext" is null)),
	CONSTRAINT "slack_connections_app_iv_check" CHECK (octet_length("slack_connections"."app_iv") = 12),
	CONSTRAINT "slack_connections_app_auth_tag_check" CHECK (octet_length("slack_connections"."app_auth_tag") = 16),
	CONSTRAINT "slack_connections_wake_check" CHECK ("slack_connections"."wake" in ('anyone', 'listed')),
	CONSTRAINT "slack_connections_people_check" CHECK (jsonb_typeof("slack_connections"."people") = 'array' and jsonb_array_length("slack_connections"."people") <= 50),
	CONSTRAINT "slack_connections_default_agent_check" CHECK (("slack_connections"."default_company_id" is null) = ("slack_connections"."default_agent_id" is null)),
	CONSTRAINT "slack_connections_max_per_hour_check" CHECK ("slack_connections"."max_per_hour" between 1 and 500),
	CONSTRAINT "slack_connections_status_check" CHECK ("slack_connections"."status" in ('off', 'connecting', 'connected', 'disconnected', 'error')),
	CONSTRAINT "slack_connections_status_message_check" CHECK (char_length("slack_connections"."status_message") between 1 and 300),
	CONSTRAINT "slack_connections_inbound_check" CHECK (not "slack_connections"."inbound" or "slack_connections"."app_ciphertext" is not null)
);
--> statement-breakpoint
CREATE TABLE "slack_posts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"credential_id" uuid NOT NULL,
	"channel_id" text NOT NULL,
	"ts" text NOT NULL,
	"thread_ts" text,
	"company_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"chat_id" uuid,
	"turn_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "slack_posts_message_unique" UNIQUE("credential_id","channel_id","ts"),
	CONSTRAINT "slack_posts_ts_check" CHECK (char_length("slack_posts"."ts") between 1 and 40),
	CONSTRAINT "slack_posts_channel_check" CHECK (char_length("slack_posts"."channel_id") between 1 and 40)
);
--> statement-breakpoint
CREATE TABLE "slack_threads" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"chat_id" uuid NOT NULL,
	"credential_id" uuid NOT NULL,
	"channel_id" text NOT NULL,
	"thread_ts" text,
	"place" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "slack_threads_company_id_id_unique" UNIQUE("company_id","id"),
	CONSTRAINT "slack_threads_conversation_unique" UNIQUE NULLS NOT DISTINCT("company_id","agent_id","credential_id","channel_id","thread_ts"),
	CONSTRAINT "slack_threads_chat_unique" UNIQUE("company_id","chat_id"),
	CONSTRAINT "slack_threads_place_check" CHECK (char_length("slack_threads"."place") between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "slack_connections" ADD CONSTRAINT "slack_connections_credential_id_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."credentials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_connections" ADD CONSTRAINT "slack_connections_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_posts" ADD CONSTRAINT "slack_posts_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_posts" ADD CONSTRAINT "slack_posts_credential_id_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."credentials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_threads" ADD CONSTRAINT "slack_threads_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_threads" ADD CONSTRAINT "slack_threads_agent_fk" FOREIGN KEY ("company_id","agent_id") REFERENCES "public"."agents"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_threads" ADD CONSTRAINT "slack_threads_chat_fk" FOREIGN KEY ("company_id","chat_id") REFERENCES "public"."chats"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "slack_connections_owner_idx" ON "slack_connections" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "slack_connections_inbound_idx" ON "slack_connections" USING btree ("inbound");--> statement-breakpoint
CREATE INDEX "slack_posts_thread_idx" ON "slack_posts" USING btree ("credential_id","channel_id","thread_ts");--> statement-breakpoint
CREATE INDEX "slack_posts_turn_idx" ON "slack_posts" USING btree ("turn_id");