import { describe, expect, test } from 'bun:test'
import { CustomMeshNode, getCustomMeshFaceFrame } from '@pascal-app/core'
import { applyCustomMeshCommand } from '../custom-mesh/commands'
import { resolveCustomMeshFaceHostTransform } from './custom-mesh-face-host'

const CUSTOM_MESH_ID = 'custom-mesh_face-host'

describe('CustomMeshFaceHostFrame', () => {
  test('follows a face while its topology is being edited through a live override', () => {
    const host = CustomMeshNode.parse({ id: CUSTOM_MESH_ID })
    const result = applyCustomMeshCommand(host.topology, {
      type: 'translate-components',
      selection: { mode: 'face', ids: ['f-front'] },
      delta: [0, 0, -0.5],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const expected = getCustomMeshFaceFrame(result.topology, 'f-front')
    expect(expected).not.toBeNull()

    const transform = resolveCustomMeshFaceHostTransform(host, result.topology, 'f-front')

    expect(transform?.position).toEqual(expected!.origin)
  })
})
