CREATE TABLE "claims" (
	"id" text PRIMARY KEY NOT NULL,
	"pipe_id" text NOT NULL,
	"token_mint" text NOT NULL,
	"position_type" text,
	"amount_lamports" bigint NOT NULL,
	"tx_signature" text NOT NULL,
	"claimed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "executions" (
	"id" text PRIMARY KEY NOT NULL,
	"pipe_id" text NOT NULL,
	"status" text NOT NULL,
	"trigger_type" text NOT NULL,
	"triggered_at" timestamp with time zone NOT NULL,
	"balance_before" bigint,
	"spl_balances_before" jsonb,
	"decider_result" jsonb,
	"decider_duration_ms" integer,
	"distributions" jsonb,
	"tx_signatures" jsonb,
	"completed_at" timestamp with time zone,
	"error_message" text,
	"retry_count" integer DEFAULT 0,
	"next_retry_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pipes" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"escrow_wallet" text NOT NULL,
	"controller_type" text NOT NULL,
	"controller_id" text NOT NULL,
	"decider_type" text DEFAULT 'static' NOT NULL,
	"decider_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"destinations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"trigger_mode" jsonb DEFAULT '{"type":"manual"}'::jsonb NOT NULL,
	"last_triggered_at" timestamp with time zone,
	"retry_policy" jsonb,
	"enabled" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"age" integer
);
--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_pipe_id_pipes_id_fk" FOREIGN KEY ("pipe_id") REFERENCES "public"."pipes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_pipe_id_pipes_id_fk" FOREIGN KEY ("pipe_id") REFERENCES "public"."pipes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;