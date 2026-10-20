import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { resolveDefaultDatabasePath } from '@pascal-app/mcp/storage'

export function thumbnailFile(id: string): string {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new Error('Invalid scene id')
  return join(dirname(resolveDefaultDatabasePath()), 'thumbnails', `${id}.webp`)
}

export async function writeSceneThumbnail(id: string, bytes: Uint8Array): Promise<void> {
  const file = thumbnailFile(id)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, bytes)
}

export async function readSceneThumbnail(id: string): Promise<Uint8Array | null> {
  try {
    return await readFile(thumbnailFile(id))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

export async function sceneThumbnailUrl(id: string): Promise<string | null> {
  try {
    const { mtimeMs } = await stat(thumbnailFile(id))
    return `/api/scenes/${id}/thumbnail?t=${mtimeMs}`
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

export async function deleteSceneThumbnail(id: string): Promise<void> {
  await rm(thumbnailFile(id), { force: true })
}
