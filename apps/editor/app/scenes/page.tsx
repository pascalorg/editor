import { headers } from 'next/headers'
import Link from 'next/link'
import { CreateSceneButton } from '@/components/save-button'
import type { SceneMeta } from '@/components/scene-loader'
import { ScenesList } from './scenes-list'

export const dynamic = 'force-dynamic'

async function resolveBaseUrl(): Promise<string> {
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL
  }
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host')
  const proto = h.get('x-forwarded-proto') ?? 'http'
  if (!host) {
    return 'http://localhost:3000'
  }
  return `${proto}://${host}`
}

async function fetchScenes(): Promise<SceneMeta[]> {
  const base = await resolveBaseUrl()
  try {
    const response = await fetch(`${base}/api/scenes?limit=50`, {
      cache: 'no-store',
    })
    if (!response.ok) {
      return []
    }
    const payload = (await response.json()) as { scenes?: SceneMeta[] } | SceneMeta[]
    if (Array.isArray(payload)) {
      return payload
    }
    return payload.scenes ?? []
  } catch {
    return []
  }
}

export default async function ScenesPage() {
  const scenes = await fetchScenes()

  return <ScenesList scenes={scenes} />
}
