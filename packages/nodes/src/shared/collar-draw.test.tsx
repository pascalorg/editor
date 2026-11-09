import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  createSceneApi,
  type DuctSegmentNode,
  DuctTerminalNode,
  emitter,
  LevelNode,
  type PipeFittingNode,
  type PipeSegmentNode,
  PipeTrapNode,
  registerNode,
  useScene,
} from '@pascal-app/core'
import {
  type EditorGridEvent,
  RegistryToolProvider,
  useEditor,
  useInteractionScope,
} from '@pascal-app/editor'
import { Html } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { act, create } from '@react-three/test-renderer'
import type { ReactElement, ReactNode } from 'react'
import { ductFittingDefinition } from '../duct-fitting/definition'
import { activateDuctCollarContinuation } from '../duct-segment/continuation'
import { ductSegmentDefinition } from '../duct-segment/definition'
import DuctSegmentTool from '../duct-segment/tool'
import { ductTerminalDefinition } from '../duct-terminal/definition'
import { pipeFittingDefinition } from '../pipe-fitting/definition'
import { activatePipeCollarContinuation } from '../pipe-segment/continuation'
import { pipeSegmentDefinition } from '../pipe-segment/definition'
import { pipeGrade } from '../pipe-segment/slope'
import PipeSegmentTool from '../pipe-segment/tool'
import { pipeTrapDefinition } from '../pipe-trap/definition'

type Vec3 = readonly [number, number, number]

const building = BuildingNode.parse({})
const level = LevelNode.parse({ parentId: building.id })
const trap = PipeTrapNode.parse({
  parentId: level.id,
  position: [0, 0.5, 0],
  diameter: 1.5,
  pipeMaterial: 'abs',
})
const diffuser = DuctTerminalNode.parse({
  parentId: level.id,
  position: [4, 2.7, 0],
  mount: 'ceiling',
  terminalType: 'diffuser',
})
const trapPort = (id: 'inlet' | 'outlet') =>
  pipeTrapDefinition.ports!(trap).find((p) => p.id === id)!

const labels: unknown[] = []
const textOf = (node: unknown): string => {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join(' ')
  if (node && typeof node === 'object') {
    const element = node as { props?: { children?: unknown }; children?: unknown }
    return textOf(element.props?.children ?? element.children)
  }
  return ''
}
const shown = () => labels.map(textOf).join(' | ')

// A plan view at 100 px per metre, so a pointer on a collar snaps to it.
const plan = (x: number, z: number): EditorGridEvent => ({
  position: [x, 0, z],
  localPosition: [x, 0, z],
  screenProjection: { pointer: [x * 100, z * 100], localToScreen: [100, 0, 0, 100, 0, 0] },
  nativeEvent: {} as EditorGridEvent['nativeEvent'],
})
const move = (x: number, z: number) => act(async () => emitter.emit('grid:move', plan(x, z)))
const click = (x: number, z: number) => act(async () => emitter.emit('grid:click', plan(x, z)))
const setRunDefaults = (kind: 'pipe-segment' | 'duct-segment', patch: Record<string, unknown>) =>
  act(async () => {
    const editor = useEditor.getState()
    editor.setToolDefaults(kind, { ...editor.toolDefaults[kind], ...patch })
  })
const runDefaults = (kind: 'pipe-segment' | 'duct-segment') =>
  useEditor.getState().toolDefaults[kind] ?? {}
const pipes = () =>
  Object.values(useScene.getState().nodes).filter(
    (node): node is PipeSegmentNode => node.type === 'pipe-segment',
  )
const fittings = () =>
  Object.values(useScene.getState().nodes).filter(
    (node): node is PipeFittingNode => node.type === 'pipe-fitting',
  )
const ducts = () =>
  Object.values(useScene.getState().nodes).filter(
    (node): node is DuctSegmentNode => node.type === 'duct-segment',
  )
const expectPoint = (actual: Vec3 | undefined, expected: Vec3) => {
  expect(actual).toBeDefined()
  for (let i = 0; i < 3; i++) expect(actual![i]).toBeCloseTo(expected[i]!, 6)
}

function Viewport() {
  const gl = useThree((state) => state.gl)
  gl.domElement.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 100, height: 100 }) as DOMRect
  return null
}
const mountTool = (tool: ReactElement) =>
  create(
    <RegistryToolProvider
      value={{
        activeLevelId: level.id,
        isCameraDragging: () => false,
        sceneApi: createSceneApi(useScene),
        selectNode: () => {},
        unit: 'metric',
      }}
    >
      <Viewport />
      {tool}
    </RegistryToolProvider>,
  )

const globals = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'] as const
let savedGlobals: (PropertyDescriptor | undefined)[] = []
let savedScope: ReturnType<typeof useInteractionScope.getState>
let htmlLabels: ReturnType<typeof spyOn>
beforeEach(() => {
  savedGlobals = globals.map((name) => Object.getOwnPropertyDescriptor(globalThis, name))
  // Key listeners attach to window; labels portal into document.body.
  for (const [name, value] of [
    ['window', new EventTarget()],
    ['document', { body: { nodeType: 1, style: {} } }],
    ['IS_REACT_ACT_ENVIRONMENT', true],
  ] as const)
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true })
  savedScope = useInteractionScope.getState()
  labels.length = 0
  htmlLabels = spyOn(
    Html as unknown as { render: (props: { children?: ReactNode }) => ReactNode },
    'render',
  ).mockImplementation((props) => {
    labels.push(props.children)
    return null
  })
  for (const definition of [
    pipeSegmentDefinition,
    pipeFittingDefinition,
    pipeTrapDefinition,
    ductSegmentDefinition,
    ductFittingDefinition,
    ductTerminalDefinition,
  ])
    registerNode(definition as never)
  useScene.setState({
    nodes: {
      [building.id]: { ...building, children: [level.id] },
      [level.id]: { ...level, children: [trap.id, diffuser.id] },
      [trap.id]: trap,
      [diffuser.id]: diffuser,
    } as Record<AnyNodeId, AnyNode>,
    rootNodeIds: [building.id],
    dirtyNodes: new Set(),
    readOnly: false,
  })
  useEditor.setState({
    mode: 'build',
    magneticSnap: true,
    snappingModeByContext: { ...useEditor.getState().snappingModeByContext, wall: 'lines' },
  })
})
afterEach(() => {
  htmlLabels.mockRestore()
  useInteractionScope.setState(savedScope, true)
  globals.forEach((name, index) => {
    const saved = savedGlobals[index]
    if (saved) Object.defineProperty(globalThis, name, saved)
    else Reflect.deleteProperty(globalThis, name)
  })
})

test('a pipe run from a fixed collar leaves along its axis, then takes the chosen grade', async () => {
  const [x, y, z] = trapPort('outlet').position
  useEditor.setState({ tool: 'pipe-segment' })
  useEditor.getState().setToolDefaults('pipe-segment', {
    system: 'waste',
    fall: 'sloped',
    gradePercent: 2,
  })
  const renderer = await mountTool(<PipeSegmentTool />)
  try {
    await move(x, z)
    await click(x, z)
    // The horizontal outlet is level, so the run adopts that.
    expect(runDefaults('pipe-segment')).toMatchObject({ fall: 'level', gradePercent: 0 })

    await setRunDefaults('pipe-segment', { fall: 'sloped', gradePercent: 2 })
    labels.length = 0
    await move(x + 1, z + 0.4)
    await click(x + 1, z + 0.4)
    expect(pipes()).toHaveLength(0)
    expect(shown()).toContain(
      'The connection elevation conflicts with the chosen grade. Adjust the grade or target elevation.',
    )
    expect(shown()).not.toContain('Fitting clearance')

    await setRunDefaults('pipe-segment', { fall: 'level' })
    await click(x + 1, z + 0.4)
    const [first] = pipes()
    expectPoint(first?.path[0], [x, y, z])
    expectPoint(first?.path.at(-1), [x + 1, y, z])

    await setRunDefaults('pipe-segment', { fall: 'sloped', gradePercent: 2 })
    await move(x + 3, z)
    await click(x + 3, z)
    const second = pipes()[1]
    expectPoint(second?.path[0], [x + 1, y, z])
    expect(pipeGrade(second!.path[0]!, second!.path.at(-1)!)).toBeCloseTo(0.02, 9)
    // A 2% fall turns far less than any bend, so only the open end is capped.
    expect(fittings().map((fitting) => fitting.fittingType)).toEqual(['end-cap'])
  } finally {
    await renderer.unmount()
  }
})

test('a riser drawn from a vertical pipe collar continues on the plan route', async () => {
  const inlet = trapPort('inlet')
  const [x, y, z] = inlet.position
  activatePipeCollarContinuation(trap, inlet)
  expect(runDefaults('pipe-segment')).toMatchObject({ routingMode: 'vertical' })
  const renderer = await mountTool(<PipeSegmentTool />)
  try {
    await click(x + 0.5, z)
    expect(pipes()).toHaveLength(1)
    expectPoint(pipes()[0]?.path.at(-1), [x, y + 1, z])
    expect(runDefaults('pipe-segment').routingMode).toBe('horizontal')

    await move(x + 1.5, z)
    await click(x + 1.5, z)
    const [riser, across] = pipes()
    expectPoint(riser?.path[0], [x, y, z])
    expectPoint(across?.path.at(-1), [x + 1.5, y + 1, z])
    expect(pipeGrade(across!.path[0]!, across!.path.at(-1)!)).toBeCloseTo(0, 9)
  } finally {
    await renderer.unmount()
  }
})

test('a riser drawn from a vertical duct collar continues on the horizontal route', async () => {
  const collar = ductTerminalDefinition.ports!(diffuser)[0]!
  const [x, y, z] = collar.position
  activateDuctCollarContinuation(diffuser, collar)
  expect(runDefaults('duct-segment')).toMatchObject({ routingMode: 'vertical' })
  const renderer = await mountTool(<DuctSegmentTool />)
  try {
    await click(x + 0.5, z)
    expect(ducts()).toHaveLength(1)
    expectPoint(ducts()[0]?.path.at(-1), [x, y + 1, z])
    expect(runDefaults('duct-segment').routingMode).toBe('horizontal')

    await move(x + 1.5, z)
    await click(x + 1.5, z)
    const [riser, across] = ducts()
    expectPoint(riser?.path[0], [x, y, z])
    expectPoint(across?.path.at(-1), [x + 1.5, y + 1, z])
  } finally {
    await renderer.unmount()
  }
})
