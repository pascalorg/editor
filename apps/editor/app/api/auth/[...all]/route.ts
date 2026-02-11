/**
 * Better Auth API route handler
 * Handles all /api/auth/* routes for authentication
 */

import { toNextJsHandler } from 'better-auth/next-js'
import { auth } from '@/lib/auth'

const { GET, POST } = toNextJsHandler(auth)

export { GET, POST }
