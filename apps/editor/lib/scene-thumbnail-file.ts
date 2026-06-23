import { access } from 'node:fs/promises'
import path from 'node:path'

const localThumbnailPattern =
  /^\/scene-thumbnails\/(?<file>[A-Za-z0-9_-]+\.(?:png|jpg|webp))(?:\?v=\d+)?$/

export async function resolveExistingSceneThumbnailUrl(url: string | null): Promise<string | null> {
  if (!url) return null
  const match = localThumbnailPattern.exec(url)
  if (!match?.groups?.file) return url

  const thumbnailPath = path.join(process.cwd(), 'public', 'scene-thumbnails', match.groups.file)
  try {
    await access(thumbnailPath)
    return url
  } catch {
    return null
  }
}

export async function resolveExistingSceneThumbnailUrls<
  T extends { thumbnailUrl: string | null },
>(scenes: T[]): Promise<T[]> {
  return Promise.all(
    scenes.map(async (scene) => ({
      ...scene,
      thumbnailUrl: await resolveExistingSceneThumbnailUrl(scene.thumbnailUrl),
    })),
  )
}
