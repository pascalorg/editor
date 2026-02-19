export async function register() {
  // Only run on the server
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { createClient } = await import('@supabase/supabase-js')

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !key) return

    const supabase = createClient(url, key)

    const { data: buckets } = await supabase.storage.listBuckets()
    const exists = buckets?.some((b) => b.name === 'avatars')

    if (!exists) {
      await supabase.storage.createBucket('avatars', {
        public: true,
        fileSizeLimit: 5 * 1024 * 1024, // 5MB
        allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
      })
      console.log('Created "avatars" storage bucket')
    }
  }
}
