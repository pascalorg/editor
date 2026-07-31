import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { requireAdmin, userExists } from '@/lib/auth/admin'
import { grantMcpAccess, revokeMcpAccess } from '@/lib/mcp/tokens'
import { guardSceneApiRequest, sceneApiJson } from '@/lib/scene-api-security'

export const dynamic = 'force-dynamic'

const schema = z.object({ enabled: z.boolean() })

/**
 * Grants or revokes a user's agent (MCP) access.
 *
 * A grant returns the raw token once. It is never readable again — only its
 * hash is stored — so the panel has to show it immediately and the admin has
 * to pass it on. Granting twice replaces the previous token rather than adding
 * one, so access removed from a machine cannot be resurrected by an older copy.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = guardSceneApiRequest(request, { skipAuth: true })
  if (guard) return guard
  const admin = await requireAdmin()
  if (!admin) return sceneApiJson(request, { error: 'forbidden' }, { status: 403 })

  const { id } = await params
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return sceneApiJson(request, { error: 'invalid_request' }, { status: 400 })
  }
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return sceneApiJson(request, { error: 'invalid_request' }, { status: 400 })
  }
  if (!(await userExists(id))) {
    return sceneApiJson(request, { error: 'not_found' }, { status: 404 })
  }

  if (!parsed.data.enabled) {
    await revokeMcpAccess(id)
    return sceneApiJson(request, { ok: true })
  }

  const token = await grantMcpAccess(id)
  return sceneApiJson(request, { ok: true, token })
}
