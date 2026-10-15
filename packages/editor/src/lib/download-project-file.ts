import { getProjectFileSink, type ProjectFileSink } from '@pascal-app/core'

/** Persist before reporting a successful download; a failed save is shown by the export UI. */
export async function downloadProjectFile(
  blob: Blob,
  name: string,
  sink: ProjectFileSink | null = getProjectFileSink(),
) {
  await sink?.({ blob, name })
  if (typeof document === 'undefined') return
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
