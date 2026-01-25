CREATE TABLE "auth_nonces" (
	"nonce" text PRIMARY KEY NOT NULL,
	"wallet_address" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallet_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"secret_hash" text NOT NULL,
	"user_id" text NOT NULL,
	"wallet_address" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallet_users" (
	"id" text PRIMARY KEY NOT NULL,
	"wallet_address" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallet_users_wallet_address_unique" UNIQUE("wallet_address")
);
--> statement-breakpoint
ALTER TABLE "wallet_sessions" ADD CONSTRAINT "wallet_sessions_user_id_wallet_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."wallet_users"("id") ON DELETE no action ON UPDATE no action;