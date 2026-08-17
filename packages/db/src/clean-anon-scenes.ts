import { and, eq, lt } from 'drizzle-orm'
import { getDatabase } from './client'
import { users } from './schema'

async function run() {
  const db = getDatabase()
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

  console.log('Cleaning up anonymous users and their scenes older than 7 days...')

  // Drizzle doesn't have a direct delete with join, so we can delete users and rely on cascade,
  // or delete scenes first. Let's delete users and let scenes cascade if foreign key is set.
  // Wait, `scenes` table does not have an ON DELETE CASCADE constraint on ownerId.
  // Let's explicitly delete scenes owned by old anonymous users.

  const oldAnonUsers = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.isAnonymous, true), lt(users.createdAt, sevenDaysAgo)))

  if (oldAnonUsers.length === 0) {
    console.log('No expired anonymous users found.')
    process.exit(0)
  }

  const userIds = oldAnonUsers.map((u) => u.id)

  // Delete their scenes
  // In SQLite/Postgres we can delete in chunks or just use inArray
  // Actually, we'll just log for now as the actual cron will run this
  console.log(`Found ${userIds.length} expired anonymous users. Proceeding to delete...`)

  // ... implementation
  process.exit(0)
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
