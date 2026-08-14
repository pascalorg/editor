import { expect, test } from 'bun:test'
import { OrthographicCamera, PerspectiveCamera } from 'three'
import { snapshotCameraDepthNode } from './snapshot-pipeline'

test('keeps orthographic depth linear without perspective conversion', () => {
  const rawDepth = {}
  const linearDepth = {}
  const scenePass = {
    getLinearDepthNode: () => linearDepth,
    getTextureNode: () => ({ r: rawDepth }),
  }

  expect(snapshotCameraDepthNode(scenePass as never, new OrthographicCamera())).toBe(rawDepth)
  expect(snapshotCameraDepthNode(scenePass as never, new PerspectiveCamera())).toBe(linearDepth)
})
