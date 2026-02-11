/**
 * Better Auth API route handler
 * Handles all /api/auth/* routes for authentication
 */

import { auth } from '@pascal-app/auth/server'
import { toNextJsHandler } from 'better-auth/next-js'

export const { GET, POST } = toNextJsHandler(auth)
