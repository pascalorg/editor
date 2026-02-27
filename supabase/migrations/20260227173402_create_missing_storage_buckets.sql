-- Create project-thumbnails storage bucket (public read, service-role write)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'project-thumbnails', 
  'project-thumbnails', 
  true, 
  10485760, -- 10MB
  ARRAY['image/png']
)
ON CONFLICT (id) DO NOTHING;

-- Allow public read on project-thumbnails bucket
CREATE POLICY "Public read project thumbnails"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'project-thumbnails');

-- Allow service role (and authenticated users) to upload to project-thumbnails
CREATE POLICY "Service role upload project thumbnails"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'project-thumbnails');

-- Allow service role to update/delete project-thumbnails
CREATE POLICY "Service role update project thumbnails"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'project-thumbnails');

CREATE POLICY "Service role delete project thumbnails"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'project-thumbnails');


-- Create project-assets storage bucket (public read, service-role write)
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES (
  'project-assets', 
  'project-assets', 
  true, 
  524288000 -- 500MB
)
ON CONFLICT (id) DO NOTHING;

-- Allow public read on project-assets bucket
CREATE POLICY "Public read project assets"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'project-assets');

-- Allow service role (and authenticated users) to upload to project-assets
CREATE POLICY "Service role upload project assets"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'project-assets');

-- Allow service role to update/delete project-assets
CREATE POLICY "Service role update project assets"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'project-assets');

CREATE POLICY "Service role delete project assets"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'project-assets');


-- Create avatars storage bucket (public read, service-role write)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'avatars', 
  'avatars', 
  true, 
  5242880, -- 5MB
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO NOTHING;

-- Allow public read on avatars bucket
CREATE POLICY "Public read avatars"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'avatars');

-- Allow service role (and authenticated users) to upload to avatars
CREATE POLICY "Service role upload avatars"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'avatars');

-- Allow service role to update/delete avatars
CREATE POLICY "Service role update avatars"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'avatars');

CREATE POLICY "Service role delete avatars"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'avatars');