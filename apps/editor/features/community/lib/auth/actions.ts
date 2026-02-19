'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { db, schema } from '@pascal-app/db'
import { eq, and, ne, sql } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { getSession } from './server'
import { createServerSupabaseClient } from '../database/server'

/**
 * Sign in with a social provider (Google)
 */
export async function signInSocial(provider: 'google', callbackURL?: string) {
  const result = await auth.api.signInSocial({
    body: { provider, callbackURL: callbackURL ?? '/' },
  })
  revalidatePath('/')
  if (result.url && result.redirect) {
    redirect(result.url as '/')
  }
  return result
}

/**
 * Update the current user's public username
 */
export async function updateUsername(
  username: string,
): Promise<{ success: boolean; error?: string }> {
  const session = await getSession()
  if (!session?.user) {
    return { success: false, error: 'Not authenticated' }
  }

  // Validate username format
  const trimmed = username.trim()
  if (trimmed.length < 3) {
    return { success: false, error: 'Username must be at least 3 characters' }
  }
  if (trimmed.length > 30) {
    return { success: false, error: 'Username must be at most 30 characters' }
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
    return {
      success: false,
      error: 'Username can only contain letters, numbers, hyphens, and underscores',
    }
  }

  // Check if username is already taken (case-insensitive)
  const existing = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(
      and(
        sql`lower(${schema.users.username}) = lower(${trimmed})`,
        ne(schema.users.id, session.user.id),
      ),
    )
    .limit(1)

  if (existing.length > 0) {
    return { success: false, error: 'Username is already taken' }
  }

  await db
    .update(schema.users)
    .set({ username: trimmed })
    .where(eq(schema.users.id, session.user.id))

  revalidatePath('/')
  revalidatePath('/settings')
  return { success: true }
}

/**
 * Get the current user's username
 */
export async function getUsername(): Promise<string | null> {
  const session = await getSession()
  if (!session?.user) return null

  const result = await db
    .select({ username: schema.users.username })
    .from(schema.users)
    .where(eq(schema.users.id, session.user.id))
    .limit(1)

  return result[0]?.username ?? null
}

/**
 * Check if a username is available
 */
export async function checkUsernameAvailability(
  username: string,
): Promise<{ available: boolean }> {
  const trimmed = username.trim()
  if (trimmed.length < 3 || !/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
    return { available: false }
  }

  const existing = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(sql`lower(${schema.users.username}) = lower(${trimmed})`)
    .limit(1)

  return { available: existing.length === 0 }
}

/**
 * Get the current user's full profile
 */
export async function getUserProfile(): Promise<{
  username: string | null
  githubUrl: string | null
  xUrl: string | null
} | null> {
  const session = await getSession()
  if (!session?.user) return null

  const result = await db
    .select({
      username: schema.users.username,
      githubUrl: schema.users.githubUrl,
      xUrl: schema.users.xUrl,
    })
    .from(schema.users)
    .where(eq(schema.users.id, session.user.id))
    .limit(1)

  return result[0] ?? null
}

/**
 * Update the current user's social profile links
 */
export async function updateProfile(data: {
  githubUrl?: string | null
  xUrl?: string | null
}): Promise<{ success: boolean; error?: string }> {
  const session = await getSession()
  if (!session?.user) {
    return { success: false, error: 'Not authenticated' }
  }

  if (data.githubUrl && !/^https:\/\/(www\.)?github\.com\/.+/.test(data.githubUrl)) {
    return { success: false, error: 'Invalid GitHub URL' }
  }
  if (data.xUrl && !/^https:\/\/(www\.)?(x|twitter)\.com\/.+/.test(data.xUrl)) {
    return { success: false, error: 'Invalid X/Twitter URL' }
  }

  await db
    .update(schema.users)
    .set({
      githubUrl: data.githubUrl ?? null,
      xUrl: data.xUrl ?? null,
    })
    .where(eq(schema.users.id, session.user.id))

  revalidatePath('/settings')
  return { success: true }
}

/**
 * Get a user's public profile by username
 */
export async function getPublicProfile(username: string): Promise<{
  success: boolean
  data?: {
    id: string
    name: string
    image: string | null
    username: string
    githubUrl: string | null
    xUrl: string | null
  }
  error?: string
}> {
  const result = await db
    .select({
      id: schema.users.id,
      name: schema.users.name,
      image: schema.users.image,
      username: schema.users.username,
      githubUrl: schema.users.githubUrl,
      xUrl: schema.users.xUrl,
    })
    .from(schema.users)
    .where(sql`lower(${schema.users.username}) = lower(${username})`)
    .limit(1)

  const user = result[0]
  if (!user || !user.username) {
    return { success: false, error: 'User not found' }
  }

  return { success: true, data: user as typeof user & { username: string } }
}

/**
 * Get connected accounts for the current user
 */
export async function getConnectedAccounts(): Promise<
  { providerId: string; accountId: string }[]
> {
  const session = await getSession()
  if (!session?.user) return []

  const result = await db
    .select({
      providerId: schema.accounts.providerId,
      accountId: schema.accounts.accountId,
    })
    .from(schema.accounts)
    .where(eq(schema.accounts.userId, session.user.id))

  return result
}

/**
 * Upload avatar image to Supabase Storage and update user record
 */
export async function uploadAvatar(
  formData: FormData,
): Promise<{ success: boolean; imageUrl?: string; error?: string }> {
  const session = await getSession()
  if (!session?.user) {
    return { success: false, error: 'Not authenticated' }
  }

  const file = formData.get('avatar') as File | null
  if (!file) {
    return { success: false, error: 'No file provided' }
  }

  if (file.size > 5 * 1024 * 1024) {
    return { success: false, error: 'File too large (max 5MB)' }
  }

  if (!file.type.startsWith('image/')) {
    return { success: false, error: 'File must be an image' }
  }

  const supabase = await createServerSupabaseClient()
  const ext = file.name.split('.').pop() || 'png'
  const filename = `${session.user.id}/avatar.${ext}`

  const { data: uploadData, error: uploadError } = await supabase.storage
    .from('avatars')
    .upload(filename, file, {
      contentType: file.type,
      upsert: true,
    })

  if (uploadError) {
    return { success: false, error: `Upload failed: ${uploadError.message}` }
  }

  const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(uploadData.path)
  const imageUrl = `${urlData.publicUrl}?t=${Date.now()}`

  // Update user image in database
  await db
    .update(schema.users)
    .set({ image: imageUrl })
    .where(eq(schema.users.id, session.user.id))

  revalidatePath('/')
  revalidatePath('/settings')
  return { success: true, imageUrl }
}
