export async function register() {
  // Only run on the server
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { createClient } = await import('@supabase/supabase-js')

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !key) return

    const supabase = createClient(url, key)

    const { data: buckets } = await supabase.storage.listBuckets()
    const bucketNames = new Set(buckets?.map((b) => b.name))

    if (!bucketNames.has('avatars')) {
      await supabase.storage.createBucket('avatars', {
        public: true,
        fileSizeLimit: 5 * 1024 * 1024, // 5MB
        allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
      })
      console.log('Created "avatars" storage bucket')
    }

    if (!bucketNames.has('project-thumbnails')) {
      await supabase.storage.createBucket('project-thumbnails', {
        public: true,
        fileSizeLimit: 10 * 1024 * 1024, // 10MB (matches uploadProjectThumbnail validation)
        allowedMimeTypes: ['image/png'],
      })
      console.log('Created "project-thumbnails" storage bucket')
    }

    if (!bucketNames.has('project-assets')) {
      await supabase.storage.createBucket('project-assets', {
        public: true,
        fileSizeLimit: 500 * 1024 * 1024, // 500MB for GLB/GLTF scans
      })
      console.log('Created "project-assets" storage bucket')
    }
  }
}
