import { describe, expect, test } from 'bun:test'
import { SectionPlaneNode as SectionPlaneNodeSchema } from '@pascal-app/core'
import type { Line, Mesh } from 'three'
import { buildSectionPlaneGeometry } from './geometry'
import type { SectionPlaneNode } from './schema'

const plane = (patch: Partial<SectionPlaneNode> = {}): SectionPlaneNode =>
  SectionPlaneNodeSchema.parse({ ...patch } as never)

const childY = (group: ReturnType<typeof buildSectionPlaneGeometry>, name: string): number => {
  const child = group.getObjectByName(name)
  if (!child) throw new Error(`missing ${name}`)
  return child.position.y
}

const firstVertexY = (group: ReturnType<typeof buildSectionPlaneGeometry>, name: string) => {
  const line = group.getObjectByName(name) as Line | undefined
  if (!line) throw new Error(`missing ${name}`)
  return (line.geometry.getAttribute('position').array as ArrayLike<number>)[1] as number
}

describe('buildSectionPlaneGeometry', () => {
  test('emits the widget parts under one group', () => {
    const group = buildSectionPlaneGeometry(plane())

    expect(group.getObjectByName('section-plane-fill')).toBeTruthy()
    expect(group.getObjectByName('section-plane-outline')).toBeTruthy()
    expect(group.getObjectByName('section-plane-brackets')).toBeTruthy()
    expect(group.getObjectByName('section-plane-normal')).toBeTruthy()
  })

  test('sits just off the plane on the surviving side so it is not cut by itself', () => {
    // Unflipped keeps the -Y half, so the widget hangs a hair below the cut.
    expect(childY(buildSectionPlaneGeometry(plane()), 'section-plane-fill')).toBeLessThan(0)
    // Flipped keeps +Y, so it flips with it.
    expect(
      childY(buildSectionPlaneGeometry(plane({ flipped: true })), 'section-plane-fill'),
    ).toBeGreaterThan(0)
  })

  test('the offset is small enough to read as "on the plane"', () => {
    expect(Math.abs(childY(buildSectionPlaneGeometry(plane()), 'section-plane-fill'))).toBeLessThan(
      0.005,
    )
  })

  test('the outline and brackets share the widget offset', () => {
    const group = buildSectionPlaneGeometry(plane())
    const fillY = childY(group, 'section-plane-fill')

    expect(firstVertexY(group, 'section-plane-outline')).toBeCloseTo(fillY)
    expect(firstVertexY(group, 'section-plane-brackets')).toBeCloseTo(fillY)
  })

  test('the normal stalk points into the half-space being removed', () => {
    const removedEnd = (node: SectionPlaneNode) => {
      const line = buildSectionPlaneGeometry(node).getObjectByName('section-plane-normal') as Line
      return (line.geometry.getAttribute('position').array as ArrayLike<number>)[4] as number
    }

    // Unflipped removes everything above, so the stalk runs up.
    expect(removedEnd(plane())).toBeGreaterThan(0)
    expect(removedEnd(plane({ flipped: true }))).toBeLessThan(0)
  })

  test('the quad follows node.size', () => {
    const group = buildSectionPlaneGeometry(plane({ size: 30 }))
    const fill = group.getObjectByName('section-plane-fill') as Mesh
    fill.geometry.computeBoundingBox()
    const box = fill.geometry.boundingBox

    expect(box).toBeTruthy()
    if (!box) return
    expect(box.max.x - box.min.x).toBeCloseTo(30)
  })

  test('an inactive plane is drawn dimmer than an active one', () => {
    const opacity = (node: SectionPlaneNode) =>
      (
        (buildSectionPlaneGeometry(node).getObjectByName('section-plane-fill') as Mesh)
          .material as { opacity: number }
      ).opacity

    expect(opacity(plane({ active: false }))).toBeLessThan(opacity(plane({ active: true })))
  })
})
