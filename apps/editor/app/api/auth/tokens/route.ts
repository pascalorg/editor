import { getDatabase } from '@pascal-app/db'
import { apiTokens } from '@pascal-app/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import { customAlphabet } from 'nanoid'
import { NextResponse } from 'next/server'
import { getAuth } from '@/lib/auth'

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
const generateTokenValue = customAlphabet(ALPHABET, 32)

async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export async function GET(request: Request) {
  const session = await getAuth().api.getSession({ headers: request.headers })
  if (!session?.user?.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const db = getDatabase()
  const tokens = await db
    .select({
      id: apiTokens.id,
      name: apiTokens.name,
      tokenPrefix: apiTokens.tokenPrefix,
      scopes: apiTokens.scopes,
      createdAt: apiTokens.createdAt,
      lastUsedAt: apiTokens.lastUsedAt,
      expiresAt: apiTokens.expiresAt,
    })
    .from(apiTokens)
    .where(and(eq(apiTokens.userId, session.user.id), isNull(apiTokens.revokedAt)))

  return NextResponse.json({ tokens })
}

export async function POST(request: Request) {
  const session = await getAuth().api.getSession({ headers: request.headers })
  if (!session?.user?.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await request.json()
  if (!body.name || typeof body.name !== 'string') {
    return NextResponse.json({ error: 'invalid_name' }, { status: 400 })
  }

  const scopes = Array.isArray(body.scopes) ? body.scopes : ['scenes:read']

  const secret = generateTokenValue()
  const token = `pascal_pat_${secret}`
  const tokenHash = await hashToken(token) // hash the FULL token string
  const tokenPrefix = secret.slice(0, 4)

  const db = getDatabase()
  const [row] = await db
    .insert(apiTokens)
    .values({
      userId: session.user.id,
      name: body.name,
      tokenHash,
      tokenPrefix,
      scopes,
    })
    .returning({ id: apiTokens.id })

  if (!row) return NextResponse.json({ error: 'internal_error' }, { status: 500 })

  return NextResponse.json({ id: row.id, token })
}

export async function DELETE(request: Request) {
  const session = await getAuth().api.getSession({ headers: request.headers })
  if (!session?.user?.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const url = new URL(request.url)
  const id = url.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'invalid_id' }, { status: 400 })

  const db = getDatabase()
  await db
    .update(apiTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiTokens.id, id), eq(apiTokens.userId, session.user.id)))

  return NextResponse.json({ success: true })
}
