import { and, eq, lt, inArray, isNotNull } from 'drizzle-orm'
import { getDatabase } from './client'
import { users, scenes, sceneVersions, sceneEvents, agentRequests } from './schema'

async function run() {
  const db = getDatabase()
  const now = new Date()
  
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)

  console.log('Running data retention cleanup...')

  // 1. Clean up old anonymous users (7 days)
  const oldAnonUsers = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.isAnonymous, true), lt(users.createdAt, sevenDaysAgo)))

  if (oldAnonUsers.length > 0) {
    const anonUserIds = oldAnonUsers.map((u) => u.id)
    console.log(`Deleting ${anonUserIds.length} expired anonymous users...`)
    
    // Delete scenes owned by anonymous users
    await db.delete(scenes).where(inArray(scenes.ownerId, anonUserIds))
    // Delete users
    await db.delete(users).where(inArray(users.id, anonUserIds))
  }

  // 2. Clean up soft-deleted users (30 days)
  const softDeletedUsers = await db
    .select({ id: users.id })
    .from(users)
    .where(and(isNotNull(users.deletedAt), lt(users.deletedAt, thirtyDaysAgo)))

  if (softDeletedUsers.length > 0) {
    const deletedUserIds = softDeletedUsers.map((u) => u.id)
    console.log(`Permanently deleting ${deletedUserIds.length} soft-deleted users (past 30 days)...`)
    
    // Delete their scenes
    await db.delete(scenes).where(inArray(scenes.ownerId, deletedUserIds))
    // Delete the users
    await db.delete(users).where(inArray(users.id, deletedUserIds))
  }

  // 3. Clean up soft-deleted scenes not tied to a user (30 days)
  const softDeletedScenes = await db
    .select({ id: scenes.id })
    .from(scenes)
    .where(and(isNotNull(scenes.deletedAt), lt(scenes.deletedAt, thirtyDaysAgo)))

  if (softDeletedScenes.length > 0) {
    const deletedSceneIds = softDeletedScenes.map((s) => s.id)
    console.log(`Permanently deleting ${deletedSceneIds.length} soft-deleted scenes...`)
    await db.delete(scenes).where(inArray(scenes.id, deletedSceneIds))
  }

  // 4. Clean up scene events / logs older than 90 days
  const deletedEvents = await db
    .delete(sceneEvents)
    .where(lt(sceneEvents.createdAt, ninetyDaysAgo))
    .returning({ id: sceneEvents.eventId })
    
  if (deletedEvents.length > 0) {
    console.log(`Deleted ${deletedEvents.length} scene events older than 90 days.`)
  }
  
  const deletedRequests = await db
    .delete(agentRequests)
    .where(lt(agentRequests.createdAt, ninetyDaysAgo))
    .returning({ id: agentRequests.requestId })
    
  if (deletedRequests.length > 0) {
    console.log(`Deleted ${deletedRequests.length} agent requests older than 90 days.`)
  }

  console.log('Cleanup complete.')
  process.exit(0)
}

run().catch((err) => {
  console.error('Cleanup failed:', err)
  process.exit(1)
})
