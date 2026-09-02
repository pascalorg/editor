import { describe, expect, test } from 'bun:test'
import { Euler, Vector3 } from 'three'
import { getPage, resolveWandPanelFacePose } from '@/components/xr/wand-panel/panel-layout'

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
