import { expect, test } from 'bun:test'
import { emitter, type SnapshotSavedEvent } from '@pascal-app/core'
import { downloadSnapshot } from './snapshot-download'

const camera = {
  requestId: 'shutter-1',
  position: [1, 2, 3] as [number, number, number],
  target: null,
  captureMode: 'standard' as const,
  resolution: { w: 1920, h: 1080 },
}

test('a snapshot downloads its captured blob before acknowledging the exact shutter request', async () => {
  const saved: Array<SnapshotSavedEvent | undefined> = []
  const onSaved = (event: SnapshotSavedEvent | undefined) => saved.push(event)
  emitter.on('snapshot:saved', onSaved)
  const blob = new Blob(['captured pixels'], { type: 'image/webp' })
  let complete!: (url: string) => void
  try {
    const pending = downloadSnapshot(
      'project',
      'My house / kitchen',
      blob,
      camera,
      (image, name) => {
        expect(image).toBe(blob)
        expect(name).toMatch(/^My-house-kitchen-snapshot-.*\.webp$/)
        return new Promise((resolve) => {
          complete = resolve
        })
      },
    )
    expect(saved).toEqual([])
    complete('blob:download')
    await pending
    expect(saved).toEqual([
      {
        id: 'shutter-1',
        requestId: 'shutter-1',
        projectId: 'project',
        url: 'blob:download',
        width: 1920,
        height: 1080,
      },
    ])
  } finally {
    emitter.off('snapshot:saved', onSaved)
  }
})

test('a failed download rejects without reporting that the snapshot was saved', async () => {
  const saved: Array<SnapshotSavedEvent | undefined> = []
  const onSaved = (event: SnapshotSavedEvent | undefined) => saved.push(event)
  emitter.on('snapshot:saved', onSaved)
  try {
    await expect(
      downloadSnapshot('project', 'House', new Blob(), camera, () => {
        throw new Error('Download unavailable')
      }),
    ).rejects.toThrow('Download unavailable')
    expect(saved).toEqual([])
  } finally {
    emitter.off('snapshot:saved', onSaved)
  }
})

test('PNG captures download with the correct extension and portrait dimensions', async () => {
  const blob = new Blob(['portrait pixels'], { type: 'image/png' })
  await downloadSnapshot(
    'project',
    '',
    blob,
    { ...camera, resolution: { w: 1080, h: 1920 } },
    (_, name) => {
      expect(name).toMatch(/^Pascal-snapshot-.*\.png$/)
      return 'blob:portrait'
    },
  )
})
