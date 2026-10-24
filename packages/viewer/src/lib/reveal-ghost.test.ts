import { describe, expect, test } from 'bun:test'
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, type Object3D } from 'three'
import { clearGhost, setGhost } from './reveal-ghost'

// A roof lifted out of the way turns ghostly so the rooms show from above. Its materials are the
// scene's own, shared and cached (the walls' trim among them), so a ghost never touches them: each
// mesh wears clones while it fades and gets its own materials back after.

function roof() {
  const shared = new MeshBasicMaterial({ color: 0xcc8866 })
  const other = new MeshBasicMaterial({ color: 0x888888 })
  const group = new Group()
  const shell = new Mesh(new BoxGeometry(), [shared, other])
  const flat = new Mesh(new BoxGeometry(), shared)
  shell.castShadow = flat.castShadow = true
  group.add(shell, flat)
  return { group, shell, flat, shared, other }
}

const opacityOf = (mesh: Mesh) =>
  (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map((m) => m.opacity)

describe('a ghost roof', () => {
  test('wears clones that fade, and leaves the shared materials alone', () => {
    const { group, shell, flat, shared, other } = roof()
    setGhost(group, 0.4)
    expect(opacityOf(shell)).toEqual([0.4, 0.4])
    expect(opacityOf(flat)).toEqual([0.4])
    expect(shell.material).not.toBe(shared)
    expect((shell.material as MeshBasicMaterial[])[0]).not.toBe(shared)
    expect((shell.material as MeshBasicMaterial[])[0]!.transparent).toBe(true)
    expect(shared.opacity).toBe(1)
    expect(other.opacity).toBe(1)
    expect(shared.transparent).toBe(false)
  })

  test('casts no shadow while it is faint, so the rooms below are lit', () => {
    const { group, shell, flat } = roof()
    setGhost(group, 0.5)
    expect(shell.castShadow || flat.castShadow).toBe(false)
    setGhost(group, 0.2)
    expect(shell.castShadow || flat.castShadow).toBe(false)
  })

  test('is itself again exactly when cleared: the same materials, shadows and opacity', () => {
    const { group, shell, flat, shared, other } = roof()
    setGhost(group, 0.3)
    clearGhost(group)
    expect(shell.material).toEqual([shared, other])
    expect(shell.material[0]).toBe(shared)
    expect(flat.material).toBe(shared)
    expect(shell.castShadow).toBe(true)
    expect(flat.castShadow).toBe(true)
    expect(shared.opacity).toBe(1)
  })

  test('fading all the way back to whole restores it without a clear', () => {
    const { group, shell, flat, shared } = roof()
    setGhost(group, 0.3)
    setGhost(group, 1)
    expect(flat.material).toBe(shared)
    expect(shell.castShadow).toBe(true)
  })

  test('keeps the ghost when its renderer puts the originals back mid-fade', () => {
    const { group, flat, shared } = roof()
    setGhost(group, 0.3)
    flat.material = shared
    setGhost(group, 0.3)
    expect(flat.material).not.toBe(shared)
    expect(opacityOf(flat)).toEqual([0.3])
    clearGhost(group)
    expect(flat.material).toBe(shared)
  })

  test('reuses its clones from one frame to the next', () => {
    const { group, flat } = roof()
    setGhost(group, 0.5)
    const first = flat.material
    setGhost(group, 0.45)
    expect(flat.material).toBe(first)
    expect(opacityOf(flat)).toEqual([0.45])
  })

  test('a mesh added while it is a ghost joins it, and one with nothing to clone is left alone', () => {
    const { group } = roof()
    setGhost(group, 0.4)
    const late = new Mesh(new BoxGeometry(), new MeshBasicMaterial())
    group.add(late)
    setGhost(group, 0.4)
    expect(opacityOf(late)).toEqual([0.4])
    const empty: Object3D = new Group()
    expect(() => setGhost(empty, 0.4)).not.toThrow()
  })
})
