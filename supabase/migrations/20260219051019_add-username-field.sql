ALTER TABLE "auth_users" ADD COLUMN "username" text;--> statement-breakpoint
CREATE UNIQUE INDEX "username_unique_index" ON "auth_users" USING btree (lower("username"));