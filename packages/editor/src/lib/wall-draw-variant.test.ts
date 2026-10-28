import { afterEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  emitter,
  LevelNode,
  useScene,
  WallNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { act, create } from '@react-three/test-renderer'
import { createElement } from 'react'
import useEditor from '../store/use-editor'
import { useFloorplanDraftPreview } from '../store/use-floorplan-draft-preview'
import { toolHudTitle } from './hud-title'
import {
  getDrawnWallTypes,
  getWallDrawVariant,
  getWallTypeOverride,
  selectWallDrawVariant,
  setWallTypeOverride,
  useWallDraftThickness,
  useWallSegmentDraftThickness,
  WALL_DRAW_VARIANTS,
  wallDrawVariantOf,
} from './wall-draw-variant'
import { DEFAULT_WALL_TYPES, normalizeWallTypes, wallTypeThickness } from './wall-type'

afterEach(() => {
  useEditor.getState().setContinuation('wall', 'room')
  useEditor.getState().armToolMode({ mode: 'select' })
})

describe('Rooms variants', () => {
  test('are Rectangle, Polygon and Walls, in the Build panel order', () => {
    expect(WALL_DRAW_VARIANTS.map((variant) => [variant.id, variant.label, variant.mode])).toEqual([
      ['rectangle', 'Rectangle', 'rectangle'],
      ['polygon', 'Polygon', 'room'],
      ['walls', 'Walls', 'single'],
    ])
  })

  test('default to the chain that closes into a room', () => {
    expect(getWallDrawVariant()).toBe('polygon')
    expect(wallDrawVariantOf('unknown')).toBe('polygon')
  })

  test('picking one sets the wall tool drawing mode, and it sticks', () => {
    for (const variant of WALL_DRAW_VARIANTS) {
      selectWallDrawVariant(variant.id)
      expect(useEditor.getState().getContinuation('wall')).toBe(variant.mode)
      expect(getWallDrawVariant()).toBe(variant.id)
    }
    // Arming the wall tool (e.g. with B) keeps the picked variant.
    selectWallDrawVariant('rectangle')
    useEditor.getState().armToolMode({ mode: 'build', tool: 'wall' })
    expect(getWallDrawVariant()).toBe('rectangle')
  })

  test('switching while the wall tool is armed drops the in-flight draft', () => {
    let cancels = 0
    const onCancel = () => {
      cancels += 1
    }
    emitter.on('tool:cancel', onCancel)
    try {
      selectWallDrawVariant('walls')
      expect(cancels).toBe(0)
      useEditor.getState().armToolMode({ mode: 'build', tool: 'wall' })
      selectWallDrawVariant('rectangle')
      expect(cancels).toBe(1)
      selectWallDrawVariant('rectangle')
      expect(cancels).toBe(1)
    } finally {
      emitter.off('tool:cancel', onCancel)
    }
  })

  test('name the HUD after the variant in hand', () => {
    expect(toolHudTitle('wall', 'rectangle')).toEqual({
      label: expect.objectContaining({ message: 'Rectangle room' }),
      icon: { kind: 'url', src: '/icons/room.webp' },
      shortcut: 'B',
    })
    expect(toolHudTitle('wall', 'room')?.label.message).toBe('Polygon room')
    expect(toolHudTitle('wall', 'single')?.label.message).toBe('Walls')
  })
})

describe('Wall types', () => {
  afterEach(() => {
    setWallTypeOverride(null)
    useEditor.setState({ wallTypes: DEFAULT_WALL_TYPES })
  })

  test('default to an Exterior 2x6 lap siding outline and 2x4 drywall partitions', () => {
    expect(useEditor.getState().wallTypes).toEqual({
      exterior: 'exterior-2x6-siding',
      interior: 'interior-2x4-drywall',
    })
    const types = getDrawnWallTypes()
    expect(types.exterior?.assembly?.presetId).toBe('exterior-2x6-siding')
    expect(types.interior?.assembly?.presetId).toBe('interior-2x4-drywall')
  })

  test('stored picks come back, unknown ones fall back to the defaults', () => {
    expect(normalizeWallTypes({ exterior: 'exterior-2x6-stucco', interior: 'plain' })).toEqual({
      exterior: 'exterior-2x6-stucco',
      interior: 'plain',
    })
    expect(normalizeWallTypes({ exterior: 'gone' })).toEqual(DEFAULT_WALL_TYPES)
    expect(normalizeWallTypes(undefined)).toEqual(DEFAULT_WALL_TYPES)
  })

  test('a session override draws every wall with one placement type', () => {
    setWallTypeOverride('interior')
    const types = getDrawnWallTypes()
    expect(types.exterior?.assembly?.presetId).toBe('interior-2x4-drywall')
    expect(types.interior?.assembly?.presetId).toBe('interior-2x4-drywall')
  })

  test('picking a Rooms shape, even the one in hand, drops the override', () => {
    selectWallDrawVariant('walls')
    setWallTypeOverride('interior')
    selectWallDrawVariant('walls')
    expect(getWallTypeOverride()).toBeNull()
    expect(getDrawnWallTypes().exterior?.assembly?.presetId).toBe('exterior-2x6-siding')
  })
})

// The draft drew a partition at the exterior type's thickness (and the plan at 0.1 m), so a wall
// drawn inside a room jumped to its 2x4 thickness on commit.
test('the wall draft draws at the thickness the wall commits with, partition or outline', async () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  ;(globalThis as { cancelAnimationFrame?: (id: number) => void }).cancelAnimationFrame ??= () => {}
  const previousViewer = useViewer.getState()
  const building = BuildingNode.parse({})
  const level = LevelNode.parse({ parentId: building.id, level: 0 })
  building.children = [level.id]
  const corners: Array<[number, number]> = [
    [0, 0],
    [4, 0],
    [4, 3],
    [0, 3],
  ]
  const walls = corners.map((start, index) =>
    WallNode.parse({ parentId: level.id, start, end: corners[(index + 1) % 4] }),
  )
  level.children = walls.map((wall) => wall.id)
  useScene
    .getState()
    .setScene(
      Object.fromEntries([building, level, ...walls].map((node) => [node.id, node])) as Record<
        AnyNodeId,
        AnyNode
      >,
      [building.id as AnyNodeId],
      { installedPlugins: [], hasExplicitPluginInstallState: false },
    )
  useViewer.getState().setSelection({ buildingId: building.id, levelId: level.id })
  const seen: number[] = []
  const Probe = () => {
    seen.push(useWallDraftThickness(0.1))
    return null
  }
  const draft = (start: [number, number], end: [number, number]) =>
    act(async () => {
      useFloorplanDraftPreview.getState().setWallDraftStart(start)
      useFloorplanDraftPreview.getState().setWallDraftEnd(end)
    })
  const renderer = await create(createElement(Probe))
  try {
    await draft([2, 0], [2, 3])
    expect(seen.at(-1)).toBe(wallTypeThickness(DEFAULT_WALL_TYPES.interior)!)
    await draft([4, 0], [8, 0])
    expect(seen.at(-1)).toBe(wallTypeThickness(DEFAULT_WALL_TYPES.exterior)!)
    await act(async () => setWallTypeOverride('interior'))
    expect(seen.at(-1)).toBe(wallTypeThickness(DEFAULT_WALL_TYPES.interior)!)
  } finally {
    await act(async () => renderer.unmount())
    setWallTypeOverride(null)
    useFloorplanDraftPreview.getState().setWallDraftStart(null)
    useFloorplanDraftPreview.getState().setWallDraftEnd(null)
    useViewer.setState(previousViewer, true)
  }
})

// A Rectangle or Polygon room has no line draft, so its sides drew at the exterior thickness: a
// closet drawn inside a room showed 2x6 + siding and committed as 2x4 partitions.
test('each side of a room drafted inside a room draws at the partition thickness it commits with', async () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  ;(globalThis as { cancelAnimationFrame?: (id: number) => void }).cancelAnimationFrame ??= () => {}
  const previousViewer = useViewer.getState()
  const building = BuildingNode.parse({})
  const level = LevelNode.parse({ parentId: building.id, level: 0 })
  building.children = [level.id]
  const house: Array<[number, number]> = [
    [0, 0],
    [6, 0],
    [6, 5],
    [0, 5],
  ]
  const walls = house.map((start, index) =>
    WallNode.parse({ parentId: level.id, start, end: house[(index + 1) % house.length] }),
  )
  level.children = walls.map((wall) => wall.id)
  useScene
    .getState()
    .setScene(
      Object.fromEntries([building, level, ...walls].map((node) => [node.id, node])) as Record<
        AnyNodeId,
        AnyNode
      >,
      [building.id as AnyNodeId],
      { installedPlugins: [], hasExplicitPluginInstallState: false },
    )
  useViewer.getState().setSelection({ buildingId: building.id, levelId: level.id })
  let thicknessOf: ((start: [number, number], end: [number, number]) => number) | null = null
  const Probe = () => {
    thicknessOf = useWallSegmentDraftThickness(0.1)
    return null
  }
  const renderer = await create(createElement(Probe))
  try {
    const closet: Array<[number, number]> = [
      [2, 2],
      [3, 2],
      [3, 3],
      [2, 3],
    ]
    const sides = closet.map((start, index) => thicknessOf!(start, closet[(index + 1) % 4]!))
    expect(sides).toEqual(Array(4).fill(wallTypeThickness(DEFAULT_WALL_TYPES.interior)!))
    expect(thicknessOf!([8, 0], [10, 0])).toBe(wallTypeThickness(DEFAULT_WALL_TYPES.exterior)!)
  } finally {
    await act(async () => renderer.unmount())
    useViewer.setState(previousViewer, true)
  }
})
