import { expect, test } from 'bun:test'
import { InstancedBufferAttribute } from 'three'
import { createDustMaterial } from './dust-material'

test('the dust writes its colour and leaves the normals and diffuse colour under it as they are', () => {
  const material = createDustMaterial(new InstancedBufferAttribute(new Float32Array(4), 1))
  expect(material.transparent).toBe(true)
  expect(material.depthWrite).toBe(false)
  // Alone in a pass without MRT it is still the output that is drawn; with MRT these two merge into
  // the pass's, and write nothing (alpha 0 under material blending).
  expect(Object.keys(material.mrtNode?.outputNodes ?? {}).sort()).toEqual([
    'diffuseColor',
    'normal',
    'output',
  ])
})
