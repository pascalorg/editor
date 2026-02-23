-- Add image upload, project context, and scene graph to feedback
ALTER TABLE feedback
  ADD COLUMN IF NOT EXISTS project_id text,
  ADD COLUMN IF NOT EXISTS images jsonb,
  ADD COLUMN IF NOT EXISTS scene_graph jsonb;

-- Create feedback-images storage bucket (public read, service-role write)
INSERT INTO storage.buckets (id, name, public)
VALUES ('feedback-images', 'feedback-images', true)
ON CONFLICT (id) DO NOTHING;

-- Allow public read on feedback-images bucket
CREATE POLICY "Public read feedback images"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'feedback-images');

-- Allow service role (and authenticated users) to upload
CREATE POLICY "Service role upload feedback images"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'feedback-images');
