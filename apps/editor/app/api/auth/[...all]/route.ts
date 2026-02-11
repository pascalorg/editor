/**
 * Better Auth API route handler
 * Handles all /api/auth/* routes for authentication
 */

import { auth } from '@pascal-app/auth/server'
import { toNextJsHandler } from 'better-auth/next-js'
import type { NextRequest } from 'next/server'

// Lazy initialization of the handler
let handler: ReturnType<typeof toNextJsHandler> | null = null

function getHandler() {
  if (!handler) {
    handler = toNextJsHandler(auth)
  }
  return handler
}

// Export route handlers that initialize lazily
export async function GET(request: NextRequest) {
  const handlers = getHandler()
  return handlers.GET(request)
}

export async function POST(request: NextRequest) {
  const handlers = getHandler()
  return handlers.POST(request)
}
