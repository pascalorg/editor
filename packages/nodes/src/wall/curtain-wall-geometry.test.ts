import { describe, expect, test } from 'bun:test'
import {
  CurtainWallConfig,
  calculateLevelMiters,
  DoorNode,
  getEffectiveNode,
  getWallCurveLength,
  sceneRegistry,
  useLiveNodeOverrides,
  WallNode,
  WindowNode,
} from '@pascal-app/core'
import { generateExtrudedWall } from '@pascal-app/viewer'
import { DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three'
import { buildCurtainOpeningFrame } from './curtain-opening-frame'
import { curtainWallGeometryAdapter } from './curtain-wall-adapter'
import { buildCurtainWallGeometry } from './curtain-wall-geometry'
import { getCurtainAwareWallMaterials } from './curtain-wall-materials'

const material = new MeshBasicMaterial({ side: DoubleSide })
function hit(mesh: Mesh, x: number, y: number) {
  return new Raycaster(new Vector3(x, y, 2), new Vector3(0, 0, -1)).intersectObject(mesh, false)
}

describe('curtain wall geometry', () => {
  for (const construction of ['stick', 'unitized'] as const) {
    for (const framing of [
      'capped',
      'vertical-caps',
      'horizontal-caps',
      'structural-glazing',
    ] as const) {
      test(`${construction} / ${framing} produces finite glass and framing`, () => {
        const wall = WallNode.parse({
          start: [0, 0],
          end: [6, 0],
          height: 3,
          thickness: 0.15,
          wallType: 'curtain',
          curtainWall: { construction, framing },
        })
        const geometry = buildCurtainWallGeometry(
          wall,
          generateExtrudedWall(wall, [], calculateLevelMiters([wall])),
        )
        expect(geometry.groups.some((group) => group.materialIndex === 0 && group.count > 0)).toBe(
          true,
        )
        expect(geometry.groups.some((group) => group.materialIndex === 1 && group.count > 0)).toBe(
          true,
        )
        expect(Array.from(geometry.getAttribute('position').array).every(Number.isFinite)).toBe(
          true,
        )
        const mesh = new Mesh(geometry, [material, material, material])
        expect(hit(mesh, 0.75, 0.75).length).toBeGreaterThan(0)
        geometry.dispose()
      })
    }
  }
  test('hosted doors cut glass and mullions, while empty panel overrides remove infill', () => {
    const wall = WallNode.parse({
      start: [0, 0],
      end: [6, 0],
      height: 3,
      thickness: 0.15,
      wallType: 'curtain',
      curtainWall: { panels: [{ column: 2, row: 0, type: 'empty' }] },
    })
    const door = DoorNode.parse({ position: [1.5, 1.05, 0], width: 0.9, height: 2.1 })
    const registered = new Mesh()
    sceneRegistry.nodes.set(wall.id, registered)
    try {
      const geometry = buildCurtainWallGeometry(
        wall,
        generateExtrudedWall(wall, [], calculateLevelMiters([wall])),
        [door],
      )
      const mesh = new Mesh(geometry, [material, material, material])
      expect(hit(mesh, 1.5, 1).length).toBe(0)
      expect(hit(mesh, 1.5, 0.02).length).toBe(0)
      expect(hit(mesh, 1.025, 1)[0]?.face?.materialIndex).toBe(0)
      expect(hit(mesh, 1.975, 1)[0]?.face?.materialIndex).toBe(0)
      expect(hit(mesh, 1.25, 2.125)[0]?.face?.materialIndex).toBe(0)
      expect(hit(mesh, 1.25, 2.4)[0]?.face?.materialIndex).toBe(1)
      expect(hit(mesh, 3.75, 0.75).length).toBe(0)
      expect(hit(mesh, 0.75, 0.75).length).toBeGreaterThan(0)
      geometry.dispose()
    } finally {
      sceneRegistry.nodes.delete(wall.id)
      registered.geometry.dispose()
    }
  })
  test('curved walls and raised supports keep finite bounds', () => {
    const wall = WallNode.parse({
      start: [2, 3],
      end: [8, 6],
      curveOffset: 1,
      height: 3,
      thickness: 0.15,
      wallType: 'curtain',
    })
    const geometry = buildCurtainWallGeometry(
      wall,
      generateExtrudedWall(wall, [], calculateLevelMiters([wall]), 0.5),
    )
    geometry.computeBoundingBox()
    expect(geometry.boundingBox!.max.y).toBeCloseTo(3)
    expect(geometry.boundingBox!.min.y).toBeCloseTo(0)
    expect(Array.from(geometry.getAttribute('position').array).every(Number.isFinite)).toBe(true)
    geometry.dispose()
  })
  test('curved walls bend shaped opening frames and cutters with the curtain surface', () => {
    const wall = WallNode.parse({
      start: [0, 0],
      end: [4, 0],
      curveOffset: 1,
      height: 3,
      thickness: 0.15,
      wallType: 'curtain',
    })
    const window = WindowNode.parse({
      position: [getWallCurveLength(wall) / 2, 1.5, 0],
      width: 1,
      height: 1,
      openingShape: 'arch',
      archHeight: 0.4,
    })
    const prepared = curtainWallGeometryAdapter.prepareChildren!(wall, [window], {
      isLive: () => false,
    })
    expect(prepared.envelopeChildren).toEqual([])
    const geometry = buildCurtainWallGeometry(
      wall,
      generateExtrudedWall(wall, prepared.envelopeChildren, calculateLevelMiters([wall])),
      prepared.renderChildren,
    )
    const mesh = new Mesh(geometry, [material, material, material])
    expect(hit(mesh, 2, 1.5)).toHaveLength(0)
    expect(hit(mesh, 2, 0.5).length).toBeGreaterThan(0)
    geometry.dispose()
  })
  test('shaped opening frames remain merge-compatible with cut curtain geometry', () => {
    const window = WindowNode.parse({
      position: [2, 1.5, 0],
      width: 1,
      height: 1,
      openingShape: 'rounded',
      cornerRadius: 0.2,
    })
    const { frame, cutter } = buildCurtainOpeningFrame(window, 0.05, 0.1)
    expect(frame.index).toBeNull()
    expect(cutter.index).toBeNull()
    frame.dispose()
    cutter.dispose()
  })
  test('live shape settings retain their shaped curtain opening preview', () => {
    const wall = WallNode.parse({ start: [0, 0], end: [4, 0], wallType: 'curtain' })
    const window = WindowNode.parse({
      openingShape: 'rounded',
      position: [2, 1.5, 0],
      width: 1,
      height: 1,
    })
    try {
      useLiveNodeOverrides.getState().set(window.id, { cornerRadius: 0.3 })
      const shaped = curtainWallGeometryAdapter.prepareChildren!(wall, [getEffectiveNode(window)], {
        isLive: () => true,
      })
      expect(shaped.renderChildren[0]).toMatchObject({
        openingShape: 'rounded',
        cornerRadius: 0.3,
      })
      useLiveNodeOverrides.getState().set(window.id, { width: 1.5 })
      const resized = curtainWallGeometryAdapter.prepareChildren!(
        wall,
        [getEffectiveNode(window)],
        { isLive: () => true },
      )
      expect(resized.renderChildren[0]).toMatchObject({ openingShape: 'rectangle', width: 1.5 })
    } finally {
      useLiveNodeOverrides.getState().clear(window.id)
    }
  })
  test('material cache changes with curtain settings and wall type', () => {
    const wall = WallNode.parse({ start: [0, 0], end: [6, 0], wallType: 'curtain' })
    const first = getCurtainAwareWallMaterials(wall)
    expect(first.visible[1]!.transparent).toBe(true)
    const changed = getCurtainAwareWallMaterials({
      ...wall,
      curtainWall: CurtainWallConfig.parse({ glassOpacity: 0.7 }),
    })
    expect(changed.visible[1]!.opacity).toBe(0.7)
    expect(changed.materialHash).not.toBe(first.materialHash)
    const standard = getCurtainAwareWallMaterials({ ...wall, wallType: 'standard' })
    expect(standard.visible[1]!.transparent).toBe(false)
  })
})
