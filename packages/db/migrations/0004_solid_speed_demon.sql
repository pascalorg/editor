ALTER TABLE "auth_users" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "scenes" ADD COLUMN "deleted_at" timestamp with time zone;