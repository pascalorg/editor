import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import {
  type AnyNodeId,
  clearSceneHistory,
  DoorNode,
  useScene,
  WALL_FACE_REGION_LIMIT,
  WallNode,
  WindowNode,
} from '@pascal-app/core'
import { BoxGeometry, BufferGeometry } from 'three'
import useEditor from '../store/use-editor'
import useInteractionScope from '../store/use-interaction-scope'
import { usePaintRegionMode } from './paint-region-mode'
import { addWallRegion, WALL_REGION_CAP_MESSAGE } from './paint-regions'
import {
  cancelWallRegion,
  dragWallRegion,
  hoverWallRegion,
  isWallRegionGestureActive,
  PICK_MATERIAL_MESSAGE,
  pressWallRegion,
  releaseWallRegion,
  useWallPaintRegionSession,
  WALL_PAINT_REGION_HANDLE,
  type WallRegionHit,
} from './wall-paint-region-session'
import {
  faceSpanStrips,
  faceSurfaceXZ,
  projectLocalRayToFace,
  resolveWallFaceBase,
  wallFaceExtent,
  wallFaceFrame,
  wallHitFaceUV,
} from './wall-region-face'
import {
  resolveWallRegionSnapMode,
  snapWallRegionValue,
  type WallRegionSnap,
  wallRegionSnapTargets,
} from './wall-region-snap'

const door = DoorNode.parse({
  id: 'door_region',
  position: [1, 1.05, 0],
  width: 0.9,
  height: 2.1,
})
const window_ = WindowNode.parse({
  id: 'window_region',
  position: [3, 1.5, 0],
  width: 1,
  height: 1.2,
})
const wall = WallNode.parse({
  id: 'wall_region_tool',
  start: [0, 0],
  end: [4, 0],
  thickness: 0.2,
  height: 2.5,
  children: [door.id, window_.id],
})
const curved = WallNode.parse({
  id: 'wall_region_curved',
  start: [0, 0],
  end: [4, 0],
  thickness: 0.2,
  curveOffset: 1,
})

const OFF: WallRegionSnap = { mode: 'off', gridStep: 0.5, tolerance: 0.1 }
const GRID: WallRegionSnap = { mode: 'grid', gridStep: 0.25, tolerance: 0.1 }
const LINES: WallRegionSnap = { mode: 'lines', gridStep: 0.5, tolerance: 0.1 }

const hit = (u: number, v: number, face: 'a' | 'b' = 'a'): WallRegionHit => ({
  wallId: wall.id,
  face,
  u,
  v,
  length: 4,
  extent: { uMin: -0.1, uMax: 4.1, top: 2.5 },
  runs: null,
})

const beforeScene = useScene.getState()
const beforeEditor = useEditor.getState()
beforeEach(() => {
  useScene.setState({
    nodes: { [wall.id]: wall, [door.id]: door, [window_.id]: window_ },
    materials: {},
    readOnly: false,
  })
  useScene.temporal.getState().resume()
  clearSceneHistory()
  useEditor.setState({
    mode: 'material-paint',
    activePaintMaterial: { materialPreset: 'library:oak', sourceTarget: 'wall' },
  })
  useInteractionScope.getState().begin({ kind: 'painting' })
})
afterEach(() => {
  cancelWallRegion()
  useInteractionScope.getState().end()
  useScene.setState(beforeScene)
  useEditor.setState(beforeEditor)
  usePaintRegionMode.getState().setMode('surface')
})
const regions = () =>
  (useScene.getState().nodes[wall.id as AnyNodeId] as WallNode).faceRegions ?? []
const pastStates = () => useScene.temporal.getState().pastStates.length

describe('face coordinates', () => {
  test('a straight wall hit reads its face, u = local x and v above the face base', () => {
    expect(wallHitFaceUV(wall, [1.5, 1.2, 0.1], [0, 0, 1], null)).toEqual({
      face: 'a',
      u: 1.5,
      v: 1.2,
    })
    expect(wallHitFaceUV(wall, [2, 0.4, -0.1], [0, 0, -1], null)).toMatchObject({ face: 'b' })
    // The top and the caps are not a face.
    expect(wallHitFaceUV(wall, [2, 2.5, 0], [0, 1, 0], null)).toBeNull()
  })

  test('a curved wall hit measures u along the chord, on the arc face it lies on', () => {
    for (const face of ['a', 'b'] as const) {
      const frame = wallFaceFrame(curved, face)
      const [x, z] = faceSurfaceXZ(frame, 1.3)
      const uv = wallHitFaceUV(curved, [x, 0.7, z], undefined, null)
      expect(uv).toMatchObject({ face, v: 0.7 })
      expect(uv!.u).toBeCloseTo(1.3, 9)
      // A ray from outside the face lands on the same chord station.
      const other = wallFaceFrame(curved, face === 'a' ? 'b' : 'a')
      const [ox, oz] = faceSurfaceXZ(other, 1.3)
      const out = [x - ox, z - oz]
      const origin: [number, number, number] = [x + out[0]! * 20, 0.7, z + out[1]! * 20]
      const projected = projectLocalRayToFace(frame, origin, [-out[0]! * 20, 0, -out[1]! * 20])
      expect(projected!.u).toBeCloseTo(1.3, 6)
      expect(projected!.y).toBeCloseTo(0.7, 6)
    }
  })

  test('a straight face projects a ray onto its plane', () => {
    const frame = wallFaceFrame(wall, 'a')
    expect(projectLocalRayToFace(frame, [2, 1, 5], [0, 0, -1])).toEqual({ u: 2, y: 1 })
    expect(projectLocalRayToFace(frame, [2, 1, 5], [0, 0, 1])).toBeNull()
  })

  test('v stands on the face own base where it steps', () => {
    const runs = {
      a: [
        { start: -1, end: 2, y: 0 },
        { start: 2, end: 5, y: -0.3 },
      ],
      b: [{ start: -1, end: 5, y: 0 }],
    }
    expect(wallHitFaceUV(wall, [1, 1, 0.1], [0, 0, 1], runs)!.v).toBeCloseTo(1, 9)
    expect(wallHitFaceUV(wall, [3, 1, 0.1], [0, 0, 1], runs)!.v).toBeCloseTo(1.3, 9)
    expect(wallHitFaceUV(wall, [3, 1, -0.1], [0, 0, -1], runs)!.v).toBeCloseTo(1, 9)
    // The region's strips follow the step, the way the renderer splits them.
    const strips = faceSpanStrips(
      wallFaceFrame(wall, 'a'),
      { uMin: 0, uMax: 4, top: 2.5 },
      runs.a,
      { v1: 0.9 },
    )
    expect(strips).toEqual([
      { u0: 0, u1: 2, low: 0, high: 0.9 },
      { u0: 2, u1: 4, low: -0.3, high: expect.closeTo(0.6, 9) },
    ])
  })

  test('the face base comes from the built geometry, else from the slab support', () => {
    const geometry = new BufferGeometry()
    const faceBase = { a: [{ start: 0, end: 4, y: -0.2 }], b: [{ start: 0, end: 4, y: 0 }] }
    geometry.userData.wallFinish = { refs: [], faceBase }
    expect(resolveWallFaceBase(wall, geometry, useScene.getState().nodes)).toBe(faceBase)
    // No slabs: both faces stand on the wall base, so heights start at local 0.
    expect(resolveWallFaceBase(wall, undefined, useScene.getState().nodes)).toBeNull()
    expect(wallFaceExtent(wall, 'a', undefined)).toEqual({ uMin: 0, uMax: 4, top: 2.5 })
  })

  test('the face extent is read off the vertices on that face', () => {
    // A mitred face reaches past the wall ends; the other face is shorter.
    const body = new BoxGeometry(4.2, 2.4, 0.2).translate(2, 1.2, 0)
    const position = body.getAttribute('position')
    for (let index = 0; index < position.count; index++)
      if (position.getZ(index) < 0)
        position.setX(index, Math.min(Math.max(position.getX(index), 0.1), 3.9))
    const faceA = wallFaceExtent(wall, 'a', body)
    expect(faceA.uMin).toBeCloseTo(-0.1, 6)
    expect(faceA.uMax).toBeCloseTo(4.1, 6)
    expect(faceA.top).toBeCloseTo(2.4, 6)
    const faceB = wallFaceExtent(wall, 'b', body)
    expect(faceB.uMin).toBeCloseTo(0.1, 6)
    expect(faceB.uMax).toBeCloseTo(3.9, 6)
  })
})

describe('snapping', () => {
  const targets = () =>
    wallRegionSnapTargets(
      {
        ...wall,
        faceRegions: [
          { id: 'r1', face: 'a', u0: 2.2, v1: 1.1, finish: 'library:oak' },
          { id: 'r2', face: 'b', u0: 1.7, finish: 'library:oak' },
        ],
      },
      'a',
      useScene.getState().nodes,
    )

  test('targets are wall ends, opening jambs / sill / head, same-face regions and 0.9', () => {
    const { u, v } = targets()
    expect(u).toEqual([0, 0.55, 1.45, 2.2, 2.5, 3.5, 4])
    expect(v).toHaveLength(4)
    for (const [index, value] of [0, 0.9, 1.1, 2.1].entries())
      expect(v[index]).toBeCloseTo(value, 9)
    expect(u).not.toContain(1.7)
  })

  test('opening heights are measured above the face base', () => {
    const runs = [{ start: -1, end: 5, y: -0.25 }]
    const { v } = wallRegionSnapTargets(wall, 'a', useScene.getState().nodes, runs)
    expect(v.some((value) => Math.abs(value - 2.35) < 1e-9)).toBe(true)
  })

  test('grid rounds, lines catch features within tolerance, off stays raw', () => {
    const { u } = targets()
    expect(snapWallRegionValue(1.13, u, GRID)).toEqual({ value: 1.25, target: null })
    expect(snapWallRegionValue(0.1 * 9 + 0.01, [], { ...GRID, gridStep: 0.1 }).value).toBe(0.9)
    expect(snapWallRegionValue(1.4, u, LINES)).toEqual({ value: 1.45, target: 1.45 })
    expect(snapWallRegionValue(3.95, u, LINES)).toEqual({ value: 4, target: 4 })
    expect(snapWallRegionValue(2.25, u, LINES)).toEqual({ value: 2.2, target: 2.2 })
    expect(snapWallRegionValue(1.8, u, LINES)).toEqual({ value: 1.8, target: null })
    expect(snapWallRegionValue(1.4, u, OFF)).toEqual({ value: 1.4, target: null })
  })

  test('modes follow the polygon snap context, Alt frees them', () => {
    expect(resolveWallRegionSnapMode({ grid: true, magnetic: false })).toBe('grid')
    expect(resolveWallRegionSnapMode({ grid: false, magnetic: true })).toBe('lines')
    expect(resolveWallRegionSnapMode({ grid: false, magnetic: false })).toBe('off')
    expect(resolveWallRegionSnapMode({ grid: true, magnetic: false, alt: true })).toBe('off')
  })
})

describe('gesture', () => {
  test('rectangle: hover marks the corner a press would start; nothing is written', () => {
    hoverWallRegion(hit(1.4, 1), LINES)
    expect(useWallPaintRegionSession.getState().preview).toMatchObject({
      // Lines snap catches the window jamb and the 0.9 m height.
      corner: [1.45, 0.9],
      bounds: null,
      pressed: false,
    })
    expect(pastStates()).toBe(0)
  })

  test('rectangle: pressed anywhere on the face, away from its ends, dragged to the opposite corner', () => {
    pressWallRegion(hit(2.3, 1.2), OFF)
    dragWallRegion(hit(1.1, 0.4), OFF)
    expect(useWallPaintRegionSession.getState().preview).toMatchObject({
      pressed: true,
      bounds: { u0: 1.1, u1: 2.3, v0: 0.4, v1: 1.2 },
    })
    releaseWallRegion()
    expect(regions()).toMatchObject([
      { face: 'a', u0: 1.1, u1: 2.3, v0: 0.4, v1: 1.2, finish: 'library:oak' },
    ])
    expect(pastStates()).toBe(1)

    pressWallRegion(hit(3.1, 1.9, 'b'), OFF)
    dragWallRegion(hit(2.2, 0.6, 'b'), OFF)
    releaseWallRegion()
    expect(regions()[1]).toMatchObject({ face: 'b', u0: 2.2, u1: 3.1, v0: 0.6, v1: 1.9 })
    expect(pastStates()).toBe(2)
  })

  test('rectangle: a click without a drag writes nothing', () => {
    pressWallRegion(hit(2, 1), OFF)
    expect(releaseWallRegion()).toBeNull()
    expect(regions()).toHaveLength(0)
  })

  test('rectangle: corner to corner, snapped and clamped; edges on the face stay open', () => {
    pressWallRegion(hit(0.52, 0.3), GRID)
    dragWallRegion(hit(1.9, 1.62), GRID)
    expect(useWallPaintRegionSession.getState().preview!.measure!.values).toEqual([1.5, 1.25])
    releaseWallRegion()
    expect(regions()[0]).toMatchObject({ u0: 0.5, u1: 2, v0: 0.25, v1: 1.5 })

    pressWallRegion(hit(3, 1), OFF)
    dragWallRegion(hit(9, 7), OFF)
    releaseWallRegion()
    const clamped = regions()[1]!
    expect(clamped).toMatchObject({ u0: 3, v0: 1 })
    expect('u1' in clamped || 'v1' in clamped).toBe(false)
  })

  test('rectangle: a degenerate box writes nothing', () => {
    pressWallRegion(hit(1, 1), OFF)
    dragWallRegion(hit(1.01, 2), OFF)
    expect(releaseWallRegion()).toBeNull()
    expect(regions()).toHaveLength(0)
    expect(pastStates()).toBe(0)
  })

  test('the drag holds one interaction scope and hands paint mode its scope back', () => {
    pressWallRegion(hit(1, 1), OFF)
    expect(useInteractionScope.getState().scope).toEqual({
      kind: 'handle-drag',
      nodeId: wall.id,
      handle: WALL_PAINT_REGION_HANDLE,
    })
    expect(isWallRegionGestureActive()).toBe(true)
    dragWallRegion(hit(2, 2), OFF)
    releaseWallRegion()
    expect(useInteractionScope.getState().scope.kind).toBe('painting')
    expect(isWallRegionGestureActive()).toBe(false)
  })

  test('Escape cancels without a write', () => {
    pressWallRegion(hit(1, 1), OFF)
    dragWallRegion(hit(2, 2), OFF)
    expect(cancelWallRegion()).toBe(true)
    expect(useWallPaintRegionSession.getState().preview).toBeNull()
    expect(releaseWallRegion()).toBeNull()
    expect(regions()).toHaveLength(0)
    expect(pastStates()).toBe(0)
    expect(useInteractionScope.getState().scope.kind).toBe('painting')
    expect(cancelWallRegion()).toBe(false)
  })

  test('a full face refuses the press with the cap message; the next gesture clears it', () => {
    for (let index = 0; index < WALL_FACE_REGION_LIMIT; index++)
      addWallRegion(wall.id, 'a', { u0: index * 0.4 }, { materialPreset: 'library:oak' })
    const before = pastStates()
    expect(pressWallRegion(hit(2, 0.4), OFF)).toBe(false)
    expect(usePaintRegionMode.getState().notice).toBe(WALL_REGION_CAP_MESSAGE)
    expect(isWallRegionGestureActive()).toBe(false)
    expect(pastStates()).toBe(before)
    expect(pressWallRegion(hit(2, 0.4, 'b'), OFF)).toBe(true)
    expect(usePaintRegionMode.getState().notice).toBeNull()
  })

  test('no material, or the eraser, refuses the press', () => {
    useEditor.setState({ activePaintMaterial: null })
    expect(pressWallRegion(hit(2, 0.4), OFF)).toBe(false)
    expect(usePaintRegionMode.getState().notice).toBe(PICK_MATERIAL_MESSAGE)
    useEditor.setState({
      activePaintMaterial: { materialPreset: 'library:oak', sourceTarget: 'wall' },
    })
    usePaintRegionMode.getState().setMode('erase')
    expect(pressWallRegion(hit(2, 0.4), OFF)).toBe(false)
    expect(regions()).toHaveLength(0)
  })
})

test('the tool draws with WebGPU node materials, never drei fat lines', () => {
  const source = readFileSync(
    new URL('../components/tools/paint-region/wall-paint-region-tool.tsx', import.meta.url),
    'utf8',
  )
  expect(source).not.toMatch(/from\s+['"]@react-three\/drei['"]/)
  expect(source).not.toMatch(/<Line\b|<lineBasicMaterial\b|<meshBasicMaterial\b|\bLineMaterial\b/)
  expect(source).toMatch(
    /import\s*\{[^}]*\bLineBasicNodeMaterial\b[^}]*\bMeshBasicNodeMaterial\b[^}]*\}\s*from\s*['"]three\/webgpu['"]/,
  )
  expect(source).toContain('layers={EDITOR_LAYER}')
  expect(source).toContain('raycast={noRaycast}')
})
