import { expect, test } from 'bun:test'
import { LawnNode } from '@pascal-app/core'
import { lawnBladeMaterial } from './blade-material'

test('tuft silhouettes use cutouts without alpha-to-coverage fringes', () => {
  const lawn = LawnNode.parse({
    outline: [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ],
  })
  const material = lawnBladeMaterial(lawn, 20)
  try {
    expect(material.alphaToCoverage).toBe(false)
    expect(material.alphaTest).toBe(0.32)
    expect(material.opacityNode).toBeDefined()
    expect(material.maskShadowNode).toBeDefined()
  } finally {
    material.dispose()
  }
})
