-- Presets table: stores door/window presets for community and user use
CREATE TABLE "presets" (
  "id" text PRIMARY KEY NOT NULL,
  "type" text NOT NULL, -- 'door' | 'window'
  "name" text NOT NULL,
  "data" jsonb NOT NULL,
  "thumbnail_url" text,
  "user_id" text REFERENCES "auth_users"("id") ON DELETE CASCADE,
  "is_community" boolean NOT NULL DEFAULT false,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint
CREATE INDEX "presets_type_idx" ON "presets"("type");
--> statement-breakpoint
CREATE INDEX "presets_user_id_idx" ON "presets"("user_id");
--> statement-breakpoint
CREATE INDEX "presets_is_community_idx" ON "presets"("is_community");

--> statement-breakpoint
ALTER TABLE "presets" ENABLE ROW LEVEL SECURITY;

--> statement-breakpoint
-- Anyone can read community presets
CREATE POLICY "Anyone can view community presets"
  ON "presets" FOR SELECT
  USING ("is_community" = true);

--> statement-breakpoint
-- Users can view their own presets
CREATE POLICY "Users can view own presets"
  ON "presets" FOR SELECT
  USING ("user_id" = current_setting('app.user_id', true)::TEXT);

--> statement-breakpoint
-- Users can insert their own presets
CREATE POLICY "Users can insert own presets"
  ON "presets" FOR INSERT
  WITH CHECK ("user_id" = current_setting('app.user_id', true)::TEXT AND "is_community" = false);

--> statement-breakpoint
-- Users can update their own presets
CREATE POLICY "Users can update own presets"
  ON "presets" FOR UPDATE
  USING ("user_id" = current_setting('app.user_id', true)::TEXT AND "is_community" = false);

--> statement-breakpoint
-- Users can delete their own presets
CREATE POLICY "Users can delete own presets"
  ON "presets" FOR DELETE
  USING ("user_id" = current_setting('app.user_id', true)::TEXT AND "is_community" = false);

--> statement-breakpoint
CREATE TRIGGER "update_presets_updated_at"
  BEFORE UPDATE ON "presets"
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
