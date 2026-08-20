import { describe, expect, test } from 'bun:test'
import { createSurfaceRoleMaterial } from '@pascal-app/viewer'
import { BoxGeometry, Group, type Material, Mesh, MeshStandardMaterial, Texture } from 'three'
import { createArticraftAppearanceController } from './appearance'

const coloredRendered = {
  colorPreset: 'clay' as const,
  ghost: false,
  sceneTheme: 'studio',
  shading: 'rendered' as const,
  textures: true,
}

describe('Articraft viewer appearance', () => {
  test('keeps authored materials in Colored + Rendered and restores them after toggles', () => {
    const authored = new MeshStandardMaterial({ color: '#336699' })
    const mesh = new Mesh(new BoxGeometry(), authored)
    const controller = createArticraftAppearanceController(mesh)

    controller.apply(coloredRendered)
    expect(mesh.material).toBe(authored)

    controller.apply({ ...coloredRendered, textures: false })
    expect(mesh.material).not.toBe(authored)

    controller.apply(coloredRendered)
    expect(mesh.material).toBe(authored)

    controller.dispose()
    expect(mesh.material).toBe(authored)
    mesh.geometry.dispose()
    authored.dispose()
  })

  test('uses a stable Lambert material with authored color and map in Solid mode', () => {
    const map = new Texture()
    const authored = new MeshStandardMaterial({ color: '#336699', map, roughness: 0.25 })
    const mesh = new Mesh(new BoxGeometry(), authored)
    const controller = createArticraftAppearanceController(mesh)

    controller.apply({ ...coloredRendered, shading: 'solid' })
    const first = mesh.material as MeshStandardMaterial
    expect(first).not.toBe(authored)
    expect(first.type).toBe('MeshLambertNodeMaterial')
    expect(first.color.getHexString()).toBe(authored.color.getHexString())
    expect(first.map).toBe(map)

    controller.apply({ ...coloredRendered, shading: 'solid' })
    expect(mesh.material).toBe(first)

    controller.dispose()
    mesh.geometry.dispose()
    map.dispose()
    authored.dispose()
  })

  test('uses the host furnishing palette in Monochrome and preserves material slots', () => {
    const authored = [
      new MeshStandardMaterial({ color: '#ff0000' }),
      new MeshStandardMaterial({ color: '#00ff00' }),
    ]
    const mesh = new Mesh(new BoxGeometry(), authored)
    const root = new Group()
    root.add(mesh)
    const controller = createArticraftAppearanceController(root)

    controller.apply({ ...coloredRendered, colorPreset: 'blueprint', textures: false })

    expect(Array.isArray(mesh.material)).toBe(true)
    expect(mesh.material).toHaveLength(2)
    const assigned = mesh.material as unknown as Material[]
    expect(assigned[0]).toBe(
      createSurfaceRoleMaterial('furnishing', 'blueprint', authored[0]!.side, 'studio'),
    )
    expect(assigned[1]).toBe(
      createSurfaceRoleMaterial('furnishing', 'blueprint', authored[1]!.side, 'studio'),
    )

    controller.dispose()
    mesh.geometry.dispose()
    for (const material of authored) material.dispose()
  })

  test('makes placement ghosts translucent without mutating authored materials', () => {
    const authored = new MeshStandardMaterial({ color: '#336699' })
    const mesh = new Mesh(new BoxGeometry(), authored)
    const controller = createArticraftAppearanceController(mesh)

    controller.apply({ ...coloredRendered, ghost: true })
    const ghost = mesh.material as MeshStandardMaterial
    expect(ghost).not.toBe(authored)
    expect(ghost.transparent).toBe(true)
    expect(ghost.opacity).toBe(0.58)
    expect(ghost.depthWrite).toBe(false)
    expect(mesh.castShadow).toBe(false)
    expect(mesh.receiveShadow).toBe(false)
    expect(authored.transparent).toBe(false)
    expect(authored.opacity).toBe(1)

    controller.dispose()
    mesh.geometry.dispose()
    authored.dispose()
  })
})
