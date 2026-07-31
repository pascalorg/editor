import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { requireAdmin, setUserRole, userExists } from '@/lib/auth/admin'
import { guardSceneApiRequest, sceneApiJson } from '@/lib/scene-api-security'

export const dynamic = 'force-dynamic'

const schema = z.object({ role: z.enum(['user', 'admin']) })

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
  if (id === admin.id && parsed.data.role !== 'admin') {
    // Don't let an admin lock themselves out of the panel.
    return sceneApiJson(request, { error: 'cannot_demote_self' }, { status: 400 })
  }
  if (!(await userExists(id))) {
    return sceneApiJson(request, { error: 'not_found' }, { status: 404 })
  }

  await setUserRole(id, parsed.data.role)
  return sceneApiJson(request, { ok: true })
}
