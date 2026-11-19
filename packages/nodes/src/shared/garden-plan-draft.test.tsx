import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  BuildingNode,
  clearSceneHistory,
  createSceneApi,
  LevelNode,
  SiteNode,
  useScene,
} from '@pascal-app/core'
import {
  FLOORPLAN_DRAFT_OUTLINE_WIDTH,
  type FloorplanToolContext,
  planDraftColors,
  sceneLayout,
  TOOL_INVALID_COLOR,
  useEditor,
  useFloorplanDraftPreview,
  useInteractionScope,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Window as TestWindow } from 'happy-dom'
import { act, type ComponentType } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useHedgeDraft } from '../hedge/draft'
import { builtinPlugin } from '../index'
import { useLawnAuthoring } from '../lawn/brush'
import { useLawnDraft } from '../lawn/draft'
import { usePlantingDraft } from '../planting/draft'

// What a person sees on the 2D plan while placing a garden object by hand: the plan's own
// target under the pointer, and a draft drawn like the plan's slab and zone drafts.

type Kind = 'tree' | 'rock' | 'hedge' | 'planting' | 'lawn'
let dom: TestWindow
let root: Root
let restore: () => void = () => {}

beforeEach(() => {
  dom = new TestWindow()
  // The plan's group maps screen to plan one to one here.
  const identity = { inverse: () => identity }
  class ScreenPoint {
    constructor(
      public x: number,
      public y: number,
    ) {}
    matrixTransform() {
      return this
    }
  }
  const globals = {
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    HTMLElement: dom.HTMLElement,
    HTMLCanvasElement: dom.HTMLCanvasElement,
    SVGElement: dom.SVGElement,
    Element: dom.Element,
    Node: dom.Node,
    Event: dom.Event,
    MouseEvent: dom.MouseEvent,
    PointerEvent: dom.PointerEvent,
    KeyboardEvent: dom.KeyboardEvent,
    DOMPoint: ScreenPoint,
    IS_REACT_ACT_ENVIRONMENT: true,
  }
  const descriptors = Object.keys(globals).map(
    (name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const,
  )
  for (const [name, value] of Object.entries(globals))
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value })
  Object.defineProperty(dom.SVGElement.prototype, 'getScreenCTM', {
    configurable: true,
    value: () => identity,
  })
  const stores = [useScene, useEditor, useViewer, useInteractionScope, useLawnAuthoring] as const
  const saved = stores.map((store) => store.getState())
  restore = () => {
    for (const [index, store] of stores.entries())
      (store.setState as (state: unknown, replace: true) => void)(saved[index], true)
    for (const draft of [useHedgeDraft, usePlantingDraft, useLawnDraft])
      draft.setState({ points: [], hover: null, error: null })
    useFloorplanDraftPreview.getState().reset()
    clearSceneHistory()
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else Reflect.deleteProperty(globalThis, name)
    }
  }
})
afterEach(async () => {
  await act(async () => root?.unmount())
  await dom.happyDOM.abort()
  restore()
})

async function mountPlanTool(kind: Kind) {
  const site = SiteNode.parse({ id: 'site_plan', children: ['building_plan'] })
  const building = BuildingNode.parse({
    id: 'building_plan',
    parentId: site.id,
    children: ['level_plan'],
  })
  const level = LevelNode.parse({ id: 'level_plan', parentId: building.id })
  useScene.setState({
    nodes: { [site.id]: site, [building.id]: building, [level.id]: level },
    rootNodeIds: [site.id],
  })
  useEditor.setState({
    mode: 'build',
    tool: kind,
    workspaceMode: 'edit',
    viewLayouts: { edit: sceneLayout('2d') },
  })
  useLawnAuthoring.setState({ mode: 'area' })
  const definition = builtinPlugin.nodes?.find((entry) => entry.kind === kind)
  const extension = definition?.extensions?.['pascal:editor/floorplan'] as
    | { tool?: () => Promise<{ default: ComponentType<FloorplanToolContext> }> }
    | undefined
  if (!extension?.tool) throw new Error(`Missing ${kind} plan tool`)
  const { default: Tool } = await extension.tool()
  root = createRoot(document.body)
  await act(async () =>
    root.render(
      <svg>
        <Tool
          {...({
            activeLevelId: level.id,
            drawingType: 'floor-plan',
            finishTool: () => {},
            sceneApi: createSceneApi(useScene),
            selectNode: () => {},
            unit: 'metric',
          } as unknown as FloorplanToolContext)}
        />
      </svg>,
    ),
  )
  const svg = document.querySelector('svg')
  if (!svg) throw new Error('Missing plan')
  const pointer = (type: string, x: number, y: number) =>
    act(async () => {
      svg.dispatchEvent(
        new dom.PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          button: 0,
          buttons: 0,
          clientX: x,
          clientY: y,
          altKey: true,
        }) as unknown as Event,
      )
    })
  return { svg, pointer }
}

for (const kind of ['tree', 'rock', 'hedge', 'planting', 'lawn'] as const) {
  test(`${kind} in hand on the plan: the plan's own target and badge follow the pointer`, async () => {
    const { pointer } = await mountPlanTool(kind)
    expect(useFloorplanDraftPreview.getState().cursorPoint).toBeNull()
    for (const [x, y] of [
      [2, 3],
      [5, 1],
    ] as const) {
      await pointer('pointermove', x, y)
      const { cursorPoint, cursorPosition } = useFloorplanDraftPreview.getState()
      // The point a click would use (plan metres), and where the pointer is (the SVG's pixels).
      expect(cursorPoint?.[0]).toBeCloseTo(x, 9)
      expect(cursorPoint?.[1]).toBeCloseTo(y, 9)
      expect(cursorPosition).toEqual({ x, y })
    }
    await act(async () => root.unmount())
    expect(useFloorplanDraftPreview.getState().cursorPoint).toBeNull()
    expect(useFloorplanDraftPreview.getState().cursorPosition).toBeNull()
  })
}

for (const [kind, draft, closed] of [
  ['hedge', useHedgeDraft, false],
  ['planting', usePlantingDraft, true],
  ['lawn', useLawnDraft, true],
] as const) {
  test(`${kind} drawn on the plan uses the plan's draft look: outline, a marker per placed point${closed ? ', filled area and closing side' : ''}`, async () => {
    const { svg } = await mountPlanTool(kind)
    const colors = planDraftColors(false)
    await act(async () =>
      draft.setState({
        points: [
          [1, 2],
          [4, 2],
          [4, 4],
        ],
        hover: [1, 4],
        error: null,
      }),
    )
    const outline = svg.querySelector('polyline')
    expect(outline?.getAttribute('stroke')).toBe(colors.stroke)
    expect(outline?.getAttribute('points')).toBe('1,2 4,2 4,4 1,4')
    // A full line of the weight the plan gives a slab draft, not the hairline.
    expect(outline?.getAttribute('stroke-width')).toBe(FLOORPLAN_DRAFT_OUTLINE_WIDTH)
    const markers = [...svg.querySelectorAll('circle')]
    expect(markers).toHaveLength(3)
    expect(new Set(markers.map((marker) => marker.getAttribute('fill')))).toEqual(
      new Set([colors.stroke]),
    )
    const area = svg.querySelector('polygon')
    const closing = svg.querySelector('line')
    if (closed) {
      expect(area?.getAttribute('fill')).toBe(colors.fill)
      expect(area?.getAttribute('points')).toBe('1,2 4,2 4,4 1,4')
      // From the pointer back to the first point, dashed.
      expect(closing?.getAttribute('stroke-dasharray')).toBeTruthy()
      expect(['x1', 'y1', 'x2', 'y2'].map((name) => Number(closing?.getAttribute(name)))).toEqual([
        1, 4, 1, 2,
      ])
    } else {
      expect(area).toBeNull()
      expect(closing).toBeNull()
    }
    // Refused: the editor's refusal red, with the reason beside the first point.
    await act(async () => draft.setState({ error: 'Refused here' }))
    expect(svg.querySelector('polyline')?.getAttribute('stroke')).toBe(TOOL_INVALID_COLOR)
    const reason = svg.querySelector('text')
    expect(reason?.textContent).toBe('Refused here')
    expect(reason?.getAttribute('fill')).toBe(TOOL_INVALID_COLOR)
  })
}
