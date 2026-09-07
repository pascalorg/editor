import { describe, expect, test } from 'bun:test'
import { Euler, Vector3 } from 'three'
import {
  getPage,
  getPageWithPinnedFirst,
  resolveWandPanelFacePose,
} from '@/components/xr/wand-panel/panel-layout'

describe('XR wand panel layout', () => {
  test('does not mount Drei line or text materials in the immersive panel', async () => {
    const files = [
      'build-panel.tsx',
      'paint-panel.tsx',
      'settings-panel.tsx',
      'spatial-controls.tsx',
      'wand-panel.tsx',
    ]
    const sources = await Promise.all(
      files.map((file) =>
        Bun.file(new URL(`../../components/xr/wand-panel/${file}`, import.meta.url)).text(),
      ),
    )

    expect(sources.join('\n')).not.toMatch(
      /import\s*\{[^}]*(?:\bLine\b|\bText\b)[^}]*\}\s*from\s*['"]@react-three\/drei['"]/,
    )
  })

  test('keeps panel switching controls out of the panel faces', async () => {
    const source = await Bun.file(
      new URL('../../components/xr/wand-panel/wand-panel.tsx', import.meta.url),
    ).text()

    expect(source).not.toContain('RingArrows')
    expect(source).toContain('pointerEventsOrder={100}')
    expect(source).toContain("pointerEventsType={{ deny: 'grab' }}")
  })

  test('puts spatial button handlers on the raycastable mesh', async () => {
    const source = await Bun.file(
      new URL('../../components/xr/wand-panel/spatial-controls.tsx', import.meta.url),
    ).text()
    const buttonSource = source.slice(
      source.indexOf('export function SpatialButton'),
      source.indexOf('export function PanelFace'),
    )

    expect(buttonSource).toMatch(/<mesh[\s\S]*onClick=/)
    expect(buttonSource).toContain('setPointerCapture?.(event.pointerId)')
    expect(buttonSource).toContain('releasePointerCapture?.(event.pointerId)')
  })

  test('keeps Select available in every build palette section and page', async () => {
    const source = await Bun.file(
      new URL('../../components/xr/wand-panel/build-panel.tsx', import.meta.url),
    ).text()

    expect(source).toContain("iconSrc: '/icons/select.webp'")
    expect(source.match(/selectEntry,/g)).toHaveLength(3)
    expect(
      getPageWithPinnedFirst(['select', ...Array.from({ length: 17 }, (_, i) => i)], 1, 9),
    ).toEqual({
      currentPage: 1,
      items: ['select', 8, 9, 10, 11, 12, 13, 14, 15],
      pageCount: 3,
    })
  })

  test('mirrors the ring faces for the opposite hand', () => {
    const left = resolveWandPanelFacePose(1, 'left')
    const right = resolveWandPanelFacePose(1, 'right')

    expect(right.position[0]).toBeCloseTo(-left.position[0])
    expect(right.position[1]).toBeCloseTo(left.position[1])
    expect(right.rotation[1]).toBeCloseTo(-left.rotation[1])
  })

  test('matches the reference three-face ring at 120 degrees', () => {
    const normals = [0, 1, 2].map((index) => {
      const pose = resolveWandPanelFacePose(index, 'left')
      expect(pose.position[2]).toBeCloseTo(0)
      const normal = new Vector3(0, 0, 1).applyEuler(new Euler(...pose.rotation))
      expect(normal.z).toBeCloseTo(0)
      return normal
    })

    expect(normals[0]!.dot(normals[1]!)).toBeCloseTo(-0.5)
    expect(normals[1]!.dot(normals[2]!)).toBeCloseTo(-0.5)
    expect(normals[2]!.dot(normals[0]!)).toBeCloseTo(-0.5)
  })

  test('clamps nested palette pages', () => {
    expect(getPage([1, 2, 3, 4, 5], 9, 2)).toEqual({
      currentPage: 2,
      items: [5],
      pageCount: 3,
    })
  })
})
