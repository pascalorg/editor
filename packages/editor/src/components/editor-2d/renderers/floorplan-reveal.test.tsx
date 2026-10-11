import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeDefinition,
  type AnyNodeId,
  BaseNode,
  clearSceneHistory,
  type FloorplanGeometry,
  LevelNode,
  loadPlugin,
  nodeRegistry,
  nodeType,
  objectId,
  type RevealConfig,
  runAsSceneCommitAuthor,
  useScene,
} from '@pascal-app/core'
import {
  type ConstructionRevealDriver,
  getRevealPlanState,
  startConstructionReveal,
  useViewer,
} from '@pascal-app/viewer'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import useEditor from '../../../store/use-editor'
import { FloorplanRegistryLayer } from './floorplan-registry-layer'
import { floorplanRevealAxis, floorplanRevealLook } from './floorplan-reveal'

// The 2D plan follows the construction reveal (E-006): a node still waiting
// for its turn is not drawn, then a wall grows along its centreline and the
// rest fades in, on the reveal's own clock.

const PLUGIN_ID = 'fixture:plan-reveal'
const base = { object: 'node', parentId: null, visible: true, metadata: {} } as const

function planKind(
  kind: string,
  prefix: string,
  reveal: RevealConfig,
  floorplan: () => FloorplanGeometry,
): { schema: typeof BaseNode; definition: AnyNodeDefinition } {
  const schema = BaseNode.extend({
    id: objectId(prefix),
    type: nodeType(kind),
    children: LevelNode.shape.children,
  })
  const definition = {
    kind,
    schemaVersion: 1,
    schema,
    category: 'structure',
    defaults: () => ({ ...base, children: [] }),
    capabilities: { reveal },
    floorplan,
  }
  return {
    schema: schema as unknown as typeof BaseNode,
    definition: definition as unknown as AnyNodeDefinition,
  }
}

const WALL_LINE = { x1: 0, y1: 0, x2: 4, y2: 0 }
const Wall = planKind(
  'fixture:plan-wall',
  'fxpwall',
  { phase: 'structure', style: 'rise' },
  () => ({
    kind: 'group',
    children: [
      {
        kind: 'polygon',
        points: [
          [0, -0.1],
          [4, -0.1],
          [4, 0.1],
          [0, 0.1],
        ],
        fill: '#222',
      },
      { kind: 'hit-line', ...WALL_LINE, strokeWidthPx: 18 },
    ],
  }),
)
const Crate = planKind(
  'fixture:plan-crate',
  'fxpcrate',
  { phase: 'furnishing', style: 'drop', height: 0.3 },
  () => ({ kind: 'rect', x: 1, y: 1, width: 0.5, height: 0.5, fill: '#888' }),
)

const make = (kind: { schema: typeof BaseNode }) => kind.schema.parse({}) as unknown as AnyNode

let driver: ConstructionRevealDriver | null = null
let restoreRegistry: () => void = () => {}
const savedScene = useScene.getState()
const savedViewer = useViewer.getState()
const savedEditor = useEditor.getState()

function plan(): string {
  // Server rendering reads Zustand's startup state; render the current scene instead.
  const useSyncExternalStore = React.useSyncExternalStore
  const serverSnapshot = spyOn(React, 'useSyncExternalStore').mockImplementation(
    (subscribe, getSnapshot) => useSyncExternalStore(subscribe, getSnapshot, getSnapshot),
  )
  try {
    return renderToStaticMarkup(
      <svg>
        <FloorplanRegistryLayer />
      </svg>,
    )
  } finally {
    serverSnapshot.mockRestore()
  }
}

function openLevel(): AnyNodeId {
  const level = LevelNode.parse({ level: 0, children: [] })
  useScene.getState().setScene({ [level.id]: level as AnyNode }, [level.id as AnyNodeId], {
    installedPlugins: [PLUGIN_ID],
    hasExplicitPluginInstallState: true,
  })
  clearSceneHistory()
  useViewer.setState({
    selection: { ...useViewer.getState().selection, levelId: level.id, selectedIds: [] },
  } as never)
  useEditor.setState({ viewMode: '2d' })
  driver = startConstructionReveal({
    reveals: (commit) => commit.author === 'agent',
    prefersReducedMotion: () => false,
  })
  return level.id as AnyNodeId
}

beforeEach(async () => {
  restoreRegistry = nodeRegistry._snapshot()
  nodeRegistry._reset()
  await loadPlugin({ id: PLUGIN_ID, apiVersion: 1, nodes: [Wall.definition, Crate.definition] })
})

afterEach(() => {
  driver?.stop()
  driver = null
  restoreRegistry()
  useScene.setState(savedScene)
  useViewer.setState(savedViewer)
  useEditor.setState(savedEditor)
})

describe('the plan during a construction reveal', () => {
  test('a node waiting for its turn is not drawn; it is once its turn comes', () => {
    const levelId = openLevel()
    const wall = make(Wall)
    const crate = make(Crate)
    runAsSceneCommitAuthor('agent', () =>
      useScene.getState().createNodes([
        { node: wall, parentId: levelId },
        { node: crate, parentId: levelId },
      ]),
    )
    let markup = plan()
    expect(markup).not.toContain(`data-node-id="${wall.id}"`)
    expect(markup).not.toContain(`data-node-id="${crate.id}"`)

    driver!.tick(0)
    expect(getRevealPlanState(wall.id)).not.toBeNull()
    // Nothing draws in a test with no canvas, so the build does not wait for a first draw to settle.
    let now = 0
    while (getRevealPlanState(wall.id)?.progress === 0 && now < 3000) {
      now += 20
      driver!.tick(now)
    }
    markup = plan()
    expect(markup).toContain(`data-node-id="${wall.id}"`)
    expect(markup).not.toContain(`data-node-id="${crate.id}"`)

    while (getRevealPlanState(crate.id)?.progress === 0 && now < 6000) {
      now += 20
      driver!.tick(now)
    }
    expect(plan()).toContain(`data-node-id="${crate.id}"`)
  })

  test("a person's own edit is drawn at once", () => {
    const levelId = openLevel()
    const wall = make(Wall)
    useScene.getState().createNode(wall, levelId)
    expect(plan()).toContain(`data-node-id="${wall.id}"`)
  })
})

describe('how a revealing entry draws', () => {
  test('a wall grows along its centreline from its start', () => {
    const axis = floorplanRevealAxis([Wall.definition.floorplan!(make(Wall), {} as never)])
    expect(axis).toEqual(WALL_LINE)

    const start = floorplanRevealLook({ style: 'rise', progress: 0 }, axis)
    const middle = floorplanRevealLook({ style: 'rise', progress: 0.5 }, axis)
    const end = floorplanRevealLook({ style: 'rise', progress: 1 }, axis)
    expect(start.opacity).toBe(1)
    expect(start.clip!.width).toBeLessThan(middle.clip!.width)
    expect(middle.clip!.width).toBeLessThan(end.clip!.width)
    // Grown, it covers the whole wall and its mitred corners.
    expect(start.clip!.x + end.clip!.width).toBeGreaterThan(WALL_LINE.x2)
    expect(start.clip!.x).toBeLessThan(WALL_LINE.x1)
    expect(end.clip!.rotateDeg).toBe(0)
    expect(
      floorplanRevealLook({ style: 'rise', progress: 0.5 }, { x1: 0, y1: 0, x2: 0, y2: 3 }).clip!
        .rotateDeg,
    ).toBe(90)
  })

  test("an undo's reverse play is the same look read backwards: a wall's clip shrinks, the rest fades out", () => {
    const axis = floorplanRevealAxis([Wall.definition.floorplan!(make(Wall), {} as never)])
    const whole = floorplanRevealLook({ style: 'rise', progress: 1 }, axis)
    const half = floorplanRevealLook({ style: 'rise', progress: 0.5 }, axis)
    const gone = floorplanRevealLook({ style: 'rise', progress: 0 }, axis)
    expect(whole.clip!.width).toBeGreaterThan(half.clip!.width)
    expect(half.clip!.width).toBeGreaterThan(gone.clip!.width)
    // Gone, the clip covers nothing of the wall (only the pad before its start).
    expect(gone.clip!.width).toBeLessThanOrEqual(1)
    expect(floorplanRevealLook({ style: 'drop', progress: 1 }, null).opacity).toBe(1)
    expect(floorplanRevealLook({ style: 'drop', progress: 0.4 }, null).opacity).toBeLessThan(1)
    expect(floorplanRevealLook({ style: 'drop', progress: 0 }, null).opacity).toBe(0)
  })

  test('everything else fades in', () => {
    for (const style of ['drop', 'settle', 'cut', 'scale', 'assemble'] as const) {
      const faint = floorplanRevealLook({ style, progress: 0.1 }, null)
      const strong = floorplanRevealLook({ style, progress: 0.8 }, null)
      expect(faint.clip).toBeNull()
      expect(faint.opacity).toBeLessThan(strong.opacity)
      expect(floorplanRevealLook({ style, progress: 1 }, null).opacity).toBe(1)
    }
    // A rising kind with no centreline fades too.
    expect(floorplanRevealLook({ style: 'rise', progress: 0.1 }, null).clip).toBeNull()
  })

  test('only a centreline outside any transformed group is an axis', () => {
    expect(floorplanRevealAxis([{ kind: 'rect', x: 0, y: 0, width: 1, height: 1 }])).toBeNull()
    expect(
      floorplanRevealAxis([
        {
          kind: 'group',
          transform: { rotate: 1 },
          children: [{ kind: 'hit-line', ...WALL_LINE, strokeWidthPx: 18 }],
        },
      ]),
    ).toBeNull()
    expect(
      floorplanRevealAxis([{ kind: 'hit-line', x1: 1, y1: 1, x2: 1, y2: 1, strokeWidthPx: 18 }]),
    ).toBeNull()
  })
})
