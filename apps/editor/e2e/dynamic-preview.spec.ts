import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { inflateSync } from 'node:zlib'
import { type APIRequestContext, expect, type Page, test } from '@playwright/test'

type SceneNode = {
  id?: string
  type?: string
  name?: string
  parentId?: string | null
  children?: string[]
  position?: [number, number, number]
  rotation?: [number, number, number]
  length?: number
  width?: number
  height?: number
  visible?: boolean
  materialPreset?: string
  widgetType?: 'label' | 'badge' | 'card' | 'chart'
  dataKey?: string
  diameter?: number
  kind?: 'vertical' | 'horizontal' | 'spherical'
  liquidColor?: string
  liquidLevel?: number
  template?: string
  title?: string
  foreground?: string
  background?: string
  fontSize?: number
  start?: [number, number]
  end?: [number, number]
  elevation?: number
  rotate?: number
  color?: string
  opacity?: number
  insulated?: boolean
  insulationThickness?: number
  pressureKpa?: number
  temperatureC?: number
  medium?: string
  showHangers?: boolean
  hangerSpacing?: number
  metadata?: Record<string, unknown>
}

type FactoryE2eBridge = {
  cameraView: (view: 'isometric' | 'top' | 'side') => void
  sceneNodes: () => Record<string, SceneNode>
  setPreviewMode: (enabled: boolean) => void
  selectNode: (nodeId: string) => void
  liveDataValue: (path: string) => unknown
  nodeTransform: (nodeId: string) => {
    position: [number, number, number]
    rotation: [number, number, number]
    scale: [number, number, number]
    visible: boolean
  } | null
}

const MOCK_PORT = Number(process.env.DYNAMIC_E2E_MOCK_WS_PORT ?? 3202)
const MOCK_HEALTH_URL = `http://localhost:${MOCK_PORT}/health`
const ids = {
  building: 'building_dynamic_preview_e2e',
  level: 'level_dynamic_preview_e2e',
  rotor: 'box_dynamic_preview_rotor_e2e',
  conveyor: 'box_dynamic_preview_conveyor_e2e',
  pipe: 'box_dynamic_preview_pipe_e2e',
  nativePipe: 'pipe_dynamic_preview_native_e2e',
  tank: 'box_dynamic_preview_tank_e2e',
  nativeTank: 'tank_dynamic_preview_native_e2e',
  valve: 'box_dynamic_preview_valve_e2e',
  light: 'box_dynamic_preview_light_e2e',
  dataWidget: 'data-widget_dynamic_preview_flow_e2e',
  dataWidgetCard: 'data-widget_dynamic_preview_temperature_card_e2e',
  dataWidgetChart: 'data-widget_dynamic_preview_fan_chart_e2e',
  invalidRotate: 'box_dynamic_preview_invalid_rotate_e2e',
  invalidConveyor: 'box_dynamic_preview_invalid_conveyor_e2e',
  visibleBool: 'box_dynamic_preview_visible_bool_e2e',
  visibleThreshold: 'box_dynamic_preview_visible_threshold_e2e',
  visibleEquals: 'box_dynamic_preview_visible_equals_e2e',
  moveRoll: 'box_dynamic_preview_move_roll_e2e',
  conditionalBlink: 'box_dynamic_preview_conditional_blink_e2e',
  conditionalColor: 'box_dynamic_preview_conditional_color_e2e',
  conditionalScale: 'box_dynamic_preview_conditional_scale_e2e',
  gradientColor: 'box_dynamic_preview_gradient_color_e2e',
  alarmScale: 'box_dynamic_preview_alarm_scale_e2e',
  reference: 'box_dynamic_preview_reference_e2e',
} as const

let mockServer: ChildProcessWithoutNullStreams | null = null

test.beforeAll(async () => {
  if (await isMockServerHealthy()) return

  mockServer = spawn(
    process.env.BUN_EXECUTABLE ?? 'bun',
    ['../../tools/mock-websocket/server.ts'],
    {
      cwd: new URL('..', import.meta.url),
      env: {
        ...process.env,
        MOCK_WS_PORT: String(MOCK_PORT),
        MOCK_WS_INTERVAL_MS: '250',
      },
    },
  )

  await waitForMockServer()
})

test.afterAll(() => {
  mockServer?.kill()
  mockServer = null
})

function dynamicPreviewGraph() {
  const nodes: Record<string, SceneNode> = {
    [ids.building]: {
      object: 'node',
      id: ids.building,
      type: 'building',
      name: 'Dynamic preview building',
      parentId: null,
      children: [ids.level],
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      visible: true,
      metadata: {},
    } as SceneNode,
    [ids.level]: {
      object: 'node',
      id: ids.level,
      type: 'level',
      name: 'Dynamic preview level',
      parentId: ids.building,
      children: [
        ids.rotor,
        ids.conveyor,
        ids.pipe,
        ids.nativePipe,
        ids.tank,
        ids.nativeTank,
        ids.valve,
        ids.light,
        ids.dataWidget,
        ids.dataWidgetCard,
        ids.dataWidgetChart,
        ids.invalidRotate,
        ids.invalidConveyor,
        ids.visibleBool,
        ids.visibleThreshold,
        ids.visibleEquals,
        ids.moveRoll,
        ids.conditionalBlink,
        ids.conditionalColor,
        ids.conditionalScale,
        ids.gradientColor,
        ids.alarmScale,
        ids.reference,
      ],
      visible: true,
      metadata: {},
    } as SceneNode,
    [ids.rotor]: {
      object: 'node',
      id: ids.rotor,
      type: 'box',
      name: 'Dynamic rotating beam',
      parentId: ids.level,
      position: [0, 1.2, 0],
      rotation: [0, 0, 0],
      length: 4,
      width: 0.35,
      height: 0.35,
      visible: true,
      materialPreset: 'metal',
      metadata: {
        semanticType: 'fan',
        dynamicBindings: [
          {
            id: 'dynamic-preview-rotate',
            type: 'rotate',
            path: 'factory.fan.speed',
            axis: 'y',
            speedRange: [3, 3],
          },
        ],
      },
    } as SceneNode,
    [ids.conveyor]: {
      object: 'node',
      id: ids.conveyor,
      type: 'box',
      name: 'Dynamic conveyor belt',
      parentId: ids.level,
      position: [0, 0.2, 1.4],
      rotation: [0, 0, 0],
      length: 4,
      width: 0.55,
      height: 0.12,
      visible: true,
      materialPreset: 'metal',
      metadata: {
        semanticType: 'conveyor',
        dynamicBindings: [
          {
            id: 'dynamic-preview-conveyor-flow',
            type: 'conveyorFlow',
            path: 'factory.conveyor.speed',
            direction: 'x',
            inputRange: [0, 2],
            speedRange: [1, 1],
            distance: 4,
            spacing: 0.8,
            loop: true,
          },
        ],
      },
    } as SceneNode,
    [ids.pipe]: {
      object: 'node',
      id: ids.pipe,
      type: 'box',
      name: 'Dynamic pipe flow',
      parentId: ids.level,
      position: [-2.8, 0.45, 0],
      rotation: [0, 0, 0],
      length: 2.4,
      width: 0.2,
      height: 0.2,
      visible: true,
      materialPreset: 'metal',
      metadata: {
        semanticType: 'pipe',
        dynamicBindings: [
          {
            id: 'dynamic-preview-pipe-flow',
            type: 'flow',
            path: 'factory.pipe.flow',
            axis: 'x',
            inputRange: [0, 100],
            speedRange: [1, 1],
            color: '#35c8ff',
          },
        ],
      },
    } as SceneNode,
    [ids.nativePipe]: {
      object: 'node',
      id: ids.nativePipe,
      type: 'pipe',
      name: 'Native dynamic pipe flow',
      parentId: ids.level,
      visible: true,
      start: [-2.8, -1.2],
      end: [-0.4, -1.2],
      elevation: 1,
      rotate: 0,
      diameter: 0.18,
      insulated: true,
      insulationThickness: 0.04,
      pressureKpa: 100,
      temperatureC: 90,
      medium: 'water',
      showHangers: true,
      hangerSpacing: 1,
      color: '#b0b8c0',
      opacity: 1,
      metadata: {
        dynamicBindings: [
          {
            id: 'dynamic-preview-native-pipe-flow',
            type: 'flow',
            path: 'factory.pipe.flow',
            inputRange: [0, 100],
            speedRange: [1, 1],
            color: '#35c8ff',
            flowMedium: 'liquid',
          },
        ],
      },
    } as SceneNode,
    [ids.tank]: {
      object: 'node',
      id: ids.tank,
      type: 'box',
      name: 'Dynamic tank level',
      parentId: ids.level,
      position: [2.7, 0.75, 0],
      rotation: [0, 0, 0],
      length: 0.8,
      width: 0.8,
      height: 1.5,
      visible: true,
      materialPreset: 'concrete',
      metadata: {
        semanticType: 'tank',
        dynamicBindings: [
          {
            id: 'dynamic-preview-tank-level',
            type: 'level',
            path: 'factory.tank.level',
            inputRange: [0, 100],
            outputRange: [0.4, 0.4],
          },
        ],
      },
    } as SceneNode,
    [ids.nativeTank]: {
      object: 'node',
      id: ids.nativeTank,
      type: 'tank',
      name: 'Native tank dynamic level',
      parentId: ids.level,
      position: [3.9, 0, 0],
      rotation: [0, 0, 0],
      kind: 'vertical',
      diameter: 0.9,
      height: 1.8,
      liquidLevel: 0.5,
      liquidColor: '#38bdf8',
      visible: true,
      metadata: {
        dynamicBindings: [
          {
            id: 'dynamic-preview-native-tank-level',
            type: 'level',
            path: 'factory.tank.level',
            inputRange: [0, 100],
            outputRange: [0.25, 0.25],
          },
        ],
      },
    } as SceneNode,
    [ids.valve]: {
      object: 'node',
      id: ids.valve,
      type: 'box',
      name: 'Dynamic valve open close',
      parentId: ids.level,
      position: [-1.4, 0.55, -1.6],
      rotation: [0, 0, 0],
      length: 0.7,
      width: 0.25,
      height: 0.7,
      visible: true,
      materialPreset: 'metal',
      metadata: {
        semanticType: 'valve',
        dynamicBindings: [
          {
            id: 'dynamic-preview-valve-open',
            type: 'openClose',
            path: 'factory.valve.open',
            axis: 'y',
            inputRange: [0, 100],
            outputRange: [0.8, 0.8],
          },
        ],
      },
    } as SceneNode,
    [ids.light]: {
      object: 'node',
      id: ids.light,
      type: 'box',
      name: 'Dynamic status light',
      parentId: ids.level,
      position: [1.5, 0.45, -1.6],
      rotation: [0, 0, 0],
      length: 0.45,
      width: 0.45,
      height: 0.45,
      visible: true,
      materialPreset: 'metal',
      metadata: {
        semanticType: 'light',
        dynamicBindings: [
          {
            id: 'dynamic-preview-light-brightness',
            type: 'brightness',
            path: 'factory.light.brightness',
            inputRange: [0, 100],
            color: '#ffd34d',
          },
        ],
      },
    } as SceneNode,
    [ids.dataWidget]: {
      object: 'node',
      id: ids.dataWidget,
      type: 'data-widget',
      name: 'Pipe Flow Data Widget',
      parentId: ids.level,
      position: [-2.8, 1.3, 0],
      rotation: [0, 0, 0],
      visible: true,
      widgetType: 'badge',
      dataKey: 'factory.pipe.flow',
      template: '{label}: {value}{unit}',
      title: 'Pipe Flow',
      foreground: '#ffffff',
      background: '#0f172a',
      fontSize: 14,
      metadata: {},
    } as SceneNode,
    [ids.dataWidgetCard]: {
      object: 'node',
      id: ids.dataWidgetCard,
      type: 'data-widget',
      name: 'Temperature Card Data Widget',
      parentId: ids.level,
      position: [1.5, 1.25, -1.6],
      rotation: [0, 0, 0],
      visible: true,
      widgetType: 'card',
      dataKey: 'factory.machine.temperature',
      template: '{label}: {value}{unit}',
      title: 'Temperature Card',
      foreground: '#ffffff',
      background: '#172033',
      fontSize: 14,
      metadata: {},
    } as SceneNode,
    [ids.dataWidgetChart]: {
      object: 'node',
      id: ids.dataWidgetChart,
      type: 'data-widget',
      name: 'Fan Speed Chart Data Widget',
      parentId: ids.level,
      position: [0, 2.0, 0],
      rotation: [0, 0, 0],
      visible: true,
      widgetType: 'chart',
      dataKey: 'factory.fan.speed',
      template: '{label}: {value}{unit}',
      title: 'Fan Speed Chart',
      foreground: '#ffffff',
      background: '#1f1b35',
      fontSize: 14,
      metadata: {},
    } as SceneNode,
    [ids.invalidRotate]: {
      object: 'node',
      id: ids.invalidRotate,
      type: 'box',
      name: 'Invalid rotate dynamic',
      parentId: ids.level,
      position: [3.7, 0.35, -1.5],
      rotation: [0, 0, 0],
      length: 0.5,
      width: 0.5,
      height: 0.5,
      visible: true,
      materialPreset: 'metal',
      metadata: {
        semanticType: 'fan',
        dynamicBindings: [
          {
            id: 'dynamic-preview-invalid-rotate',
            type: 'rotate',
            path: 'factory.missing.speed',
            inputRange: [1, 1],
            speedRange: [0, 6],
          },
        ],
      },
    } as SceneNode,
    [ids.invalidConveyor]: {
      object: 'node',
      id: ids.invalidConveyor,
      type: 'box',
      name: 'Invalid conveyor dynamic',
      parentId: ids.level,
      position: [4.4, 0.2, -1.5],
      rotation: [0, 0, 0],
      length: 0.6,
      width: 0.4,
      height: 0.2,
      visible: true,
      materialPreset: 'metal',
      metadata: {
        semanticType: 'generic',
        dynamicBindings: [
          {
            id: 'dynamic-preview-invalid-conveyor',
            type: 'conveyorFlow',
            path: 'factory.conveyor.speed',
            inputRange: [0, 2],
            speedRange: [0, 2],
            distance: 0,
            spacing: 0,
          },
        ],
      },
    } as SceneNode,
    [ids.visibleBool]: {
      object: 'node',
      id: ids.visibleBool,
      type: 'box',
      name: 'Visible bool dynamic',
      parentId: ids.level,
      position: [-3.7, 0.35, 1.6],
      rotation: [0, 0, 0],
      length: 0.45,
      width: 0.45,
      height: 0.45,
      visible: true,
      materialPreset: 'metal',
      metadata: {
        semanticType: 'generic',
        dynamicBindings: [
          {
            id: 'dynamic-preview-visible-bool',
            type: 'visible',
            path: 'factory.fan.running',
            condition: 'truthy',
          },
        ],
      },
    } as SceneNode,
    [ids.visibleThreshold]: {
      object: 'node',
      id: ids.visibleThreshold,
      type: 'box',
      name: 'Visible threshold dynamic',
      parentId: ids.level,
      position: [-3.1, 0.35, 1.6],
      rotation: [0, 0, 0],
      length: 0.45,
      width: 0.45,
      height: 0.45,
      visible: true,
      materialPreset: 'metal',
      metadata: {
        semanticType: 'generic',
        dynamicBindings: [
          {
            id: 'dynamic-preview-visible-threshold',
            type: 'visible',
            path: 'factory.pipe.flow',
            condition: 'greaterThan',
            value: -1,
          },
        ],
      },
    } as SceneNode,
    [ids.visibleEquals]: {
      object: 'node',
      id: ids.visibleEquals,
      type: 'box',
      name: 'Visible equals dynamic',
      parentId: ids.level,
      position: [-2.5, 0.35, 1.6],
      rotation: [0, 0, 0],
      length: 0.45,
      width: 0.45,
      height: 0.45,
      visible: true,
      materialPreset: 'metal',
      metadata: {
        semanticType: 'generic',
        dynamicBindings: [
          {
            id: 'dynamic-preview-visible-equals',
            type: 'visible',
            path: 'factory.fan.running',
            condition: 'equals',
            value: true,
          },
        ],
      },
    } as SceneNode,
    [ids.moveRoll]: {
      object: 'node',
      id: ids.moveRoll,
      type: 'box',
      name: 'Move roll dynamic',
      parentId: ids.level,
      position: [-1.7, 0.35, 1.6],
      rotation: [0, 0, 0],
      length: 0.45,
      width: 0.45,
      height: 0.45,
      visible: true,
      materialPreset: 'metal',
      metadata: {
        semanticType: 'generic',
        dynamicBindings: [
          {
            id: 'dynamic-preview-move-roll',
            type: 'move',
            path: 'factory.pipe.flow',
            axis: 'x',
            motionMode: 'follow',
            moveStyle: 'roll',
            inputRange: [0, 100],
            outputRange: [1, 1],
          },
        ],
      },
    } as SceneNode,
    [ids.conditionalBlink]: {
      object: 'node',
      id: ids.conditionalBlink,
      type: 'box',
      name: 'Conditional blink dynamic',
      parentId: ids.level,
      position: [-1.1, 0.35, 1.6],
      rotation: [0, 0, 0],
      length: 0.45,
      width: 0.45,
      height: 0.45,
      visible: true,
      materialPreset: 'metal',
      metadata: {
        semanticType: 'generic',
        dynamicBindings: [
          {
            id: 'dynamic-preview-conditional-blink',
            type: 'blink',
            path: 'factory.fan.running',
            condition: 'equals',
            value: true,
          },
        ],
      },
    } as SceneNode,
    [ids.conditionalColor]: {
      object: 'node',
      id: ids.conditionalColor,
      type: 'box',
      name: 'Conditional color dynamic',
      parentId: ids.level,
      position: [-0.5, 0.35, 1.6],
      rotation: [0, 0, 0],
      length: 0.45,
      width: 0.45,
      height: 0.45,
      visible: true,
      materialPreset: 'metal',
      metadata: {
        semanticType: 'generic',
        dynamicBindings: [
          {
            id: 'dynamic-preview-conditional-color',
            type: 'color',
            path: 'factory.pipe.flow',
            condition: 'lessThan',
            value: 101,
            color: '#ff0000',
          },
        ],
      },
    } as SceneNode,
    [ids.conditionalScale]: {
      object: 'node',
      id: ids.conditionalScale,
      type: 'box',
      name: 'Conditional scale dynamic',
      parentId: ids.level,
      position: [0.1, 0.35, 1.6],
      rotation: [0, 0, 0],
      length: 0.45,
      width: 0.45,
      height: 0.45,
      visible: true,
      materialPreset: 'metal',
      metadata: {
        semanticType: 'generic',
        dynamicBindings: [
          {
            id: 'dynamic-preview-conditional-scale',
            type: 'scale',
            path: 'factory.pipe.flow',
            condition: 'greaterThan',
            value: -1,
            outputRange: [1, 1.4],
          },
        ],
      },
    } as SceneNode,
    [ids.gradientColor]: {
      object: 'node',
      id: ids.gradientColor,
      type: 'box',
      name: 'Gradient color dynamic',
      parentId: ids.level,
      position: [0.7, 0.35, 1.6],
      rotation: [0, 0, 0],
      length: 0.45,
      width: 0.45,
      height: 0.45,
      visible: true,
      materialPreset: 'metal',
      metadata: {
        semanticType: 'generic',
        dynamicBindings: [
          {
            id: 'dynamic-preview-gradient-color',
            type: 'color',
            path: 'factory.pipe.flow',
            colorMode: 'gradient',
            inputRange: [-1, 0],
            color: '#35c8ff',
            endColor: '#ff0000',
          },
        ],
      },
    } as SceneNode,
    [ids.alarmScale]: {
      object: 'node',
      id: ids.alarmScale,
      type: 'box',
      name: 'Alarm pulse scale dynamic',
      parentId: ids.level,
      position: [1.3, 0.35, 1.6],
      rotation: [0, 0, 0],
      length: 0.45,
      width: 0.45,
      height: 0.45,
      visible: true,
      materialPreset: 'metal',
      metadata: {
        semanticType: 'generic',
        dynamicBindings: [
          {
            id: 'dynamic-preview-alarm-scale',
            type: 'scale',
            path: 'factory.pipe.flow',
            condition: 'greaterThan',
            value: -1,
            scaleEffect: 'alarmPulse',
            outputRange: [1, 1.5],
            speedRange: [0, 12],
          },
        ],
      },
    } as SceneNode,
    [ids.reference]: {
      object: 'node',
      id: ids.reference,
      type: 'box',
      name: 'Static reference beam',
      parentId: ids.level,
      position: [0, 0.2, -1.2],
      rotation: [0, 0, 0],
      length: 4,
      width: 0.2,
      height: 0.2,
      visible: true,
      materialPreset: 'concrete',
      metadata: {},
    } as SceneNode,
  }

  return {
    nodes,
    rootNodeIds: [ids.building],
  }
}

async function waitForMockServer() {
  const deadline = Date.now() + 15_000
  let lastError = ''
  while (Date.now() < deadline) {
    const result = await isMockServerHealthy()
    if (result === true) return
    lastError = result
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`mock websocket did not start at ${MOCK_HEALTH_URL}: ${lastError}`)
}

async function isMockServerHealthy(): Promise<true | string> {
  try {
    const response = await fetch(MOCK_HEALTH_URL)
    if (response.ok) return true
    return `status ${response.status}`
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

async function expectFactoryBridge(page: Page) {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const bridge = (
            window as Window & {
              __pascalFactoryE2e?: Partial<FactoryE2eBridge>
            }
          ).__pascalFactoryE2e
          return (
            typeof bridge?.cameraView === 'function' &&
            typeof bridge.sceneNodes === 'function' &&
            typeof bridge.setPreviewMode === 'function' &&
            typeof bridge.liveDataValue === 'function' &&
            typeof bridge.nodeTransform === 'function'
          )
        }),
      { timeout: 30_000 },
    )
    .toBe(true)
}

async function setIsometricView(page: Page) {
  await expectFactoryBridge(page)
  await page.evaluate(() => {
    const bridge = (
      window as Window & {
        __pascalFactoryE2e?: FactoryE2eBridge
      }
    ).__pascalFactoryE2e
    bridge?.cameraView('isometric')
  })
  await page.waitForTimeout(900)
}

async function createScene(request: APIRequestContext) {
  const sceneId = `dynamic-preview-${Date.now()}-${test.info().parallelIndex}`
  const response = await request.post('/api/scenes', {
    data: {
      id: sceneId,
      name: 'Dynamic preview E2E',
      graph: dynamicPreviewGraph(),
    },
  })
  expect(response.status()).toBe(201)
  return sceneId
}

function readUInt32(buffer: Buffer, offset: number) {
  return buffer.readUInt32BE(offset)
}

function paeth(left: number, up: number, upLeft: number) {
  const p = left + up - upLeft
  const pa = Math.abs(p - left)
  const pb = Math.abs(p - up)
  const pc = Math.abs(p - upLeft)
  if (pa <= pb && pa <= pc) return left
  return pb <= pc ? up : upLeft
}

function decodePng(buffer: Buffer) {
  if (buffer.subarray(0, 8).compare(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) !== 0) {
    throw new Error('screenshot is not a PNG')
  }

  let offset = 8
  let width = 0
  let height = 0
  let colorType = 0
  let bitDepth = 0
  const idat: Buffer[] = []

  while (offset < buffer.length) {
    const length = readUInt32(buffer, offset)
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii')
    const data = buffer.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = readUInt32(data, 0)
      height = readUInt32(data, 4)
      bitDepth = data[8] ?? 0
      colorType = data[9] ?? 0
      if ((data[12] ?? 0) !== 0) throw new Error('interlaced PNG screenshots are not supported')
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') {
      break
    }
    offset += 12 + length
  }

  if (bitDepth !== 8) throw new Error(`unsupported PNG bit depth ${bitDepth}`)
  const channels =
    colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 4 ? 2 : colorType === 0 ? 1 : 0
  if (!channels) throw new Error(`unsupported PNG color type ${colorType}`)

  const inflated = inflateSync(Buffer.concat(idat))
  const rowBytes = width * channels
  const pixels = Buffer.alloc(width * height * 4)
  let inputOffset = 0
  let previous = Buffer.alloc(rowBytes)

  for (let y = 0; y < height; y += 1) {
    const filter = inflated[inputOffset] ?? 0
    inputOffset += 1
    const raw = Buffer.from(inflated.subarray(inputOffset, inputOffset + rowBytes))
    inputOffset += rowBytes
    const row = Buffer.alloc(rowBytes)

    for (let x = 0; x < rowBytes; x += 1) {
      const left = x >= channels ? (row[x - channels] ?? 0) : 0
      const up = previous[x] ?? 0
      const upLeft = x >= channels ? (previous[x - channels] ?? 0) : 0
      const value = raw[x] ?? 0
      row[x] =
        filter === 0
          ? value
          : filter === 1
            ? (value + left) & 255
            : filter === 2
              ? (value + up) & 255
              : filter === 3
                ? (value + Math.floor((left + up) / 2)) & 255
                : filter === 4
                  ? (value + paeth(left, up, upLeft)) & 255
                  : value
    }

    for (let x = 0; x < width; x += 1) {
      const source = x * channels
      const target = (y * width + x) * 4
      const r = row[source] ?? 0
      const g = colorType === 0 || colorType === 4 ? r : (row[source + 1] ?? 0)
      const b = colorType === 0 || colorType === 4 ? r : (row[source + 2] ?? 0)
      const a =
        colorType === 6
          ? (row[source + 3] ?? 255)
          : colorType === 4
            ? (row[source + 1] ?? 255)
            : 255
      pixels[target] = r
      pixels[target + 1] = g
      pixels[target + 2] = b
      pixels[target + 3] = a
    }

    previous = row
  }

  return { width, height, pixels }
}

function changedPixelCount(before: Buffer, after: Buffer) {
  const first = decodePng(before)
  const second = decodePng(after)
  if (first.width !== second.width || first.height !== second.height) {
    throw new Error('screenshots have different dimensions')
  }

  let changed = 0
  for (let index = 0; index < first.pixels.length; index += 4) {
    const delta =
      Math.abs((first.pixels[index] ?? 0) - (second.pixels[index] ?? 0)) +
      Math.abs((first.pixels[index + 1] ?? 0) - (second.pixels[index + 1] ?? 0)) +
      Math.abs((first.pixels[index + 2] ?? 0) - (second.pixels[index + 2] ?? 0))
    if (delta > 24) changed += 1
  }
  return changed
}

test('preview mode applies websocket-driven rotation dynamics', async ({ page, request }) => {
  const sceneId = await createScene(request)
  const consoleErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => consoleErrors.push(error.message))

  try {
    await page.goto(`/scene/${sceneId}?factoryE2e=1`, {
      waitUntil: 'domcontentloaded',
      timeout: 180_000,
    })
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 60_000 })
    await expectFactoryBridge(page)
    await setIsometricView(page)
    await page
      .getByText(/Rendering/i)
      .waitFor({ state: 'hidden', timeout: 60_000 })
      .catch(() => undefined)

    await page.evaluate(() => {
      const bridge = (
        window as Window & {
          __pascalFactoryE2e?: FactoryE2eBridge
        }
      ).__pascalFactoryE2e
      bridge?.setPreviewMode(true)
    })
    await expect
      .poll(
        () =>
          page.evaluate((nodeId) => {
            const runtime = (
              window as Window & {
                __pascalDynamicPreviewRuntime?: {
                  entries?: Array<{ nodeId: string; rotation: [number, number, number] }>
                }
              }
            ).__pascalDynamicPreviewRuntime
            return runtime?.entries?.find((entry) => entry.nodeId === nodeId)?.rotation[1] ?? null
          }, ids.rotor),
        { timeout: 30_000 },
      )
      .not.toBeNull()

    const rotation1 = await page.evaluate((nodeId) => {
      const runtime = (
        window as Window & {
          __pascalDynamicPreviewRuntime?: {
            entries?: Array<{ nodeId: string; rotation: [number, number, number] }>
          }
        }
      ).__pascalDynamicPreviewRuntime
      return runtime?.entries?.find((entry) => entry.nodeId === nodeId)?.rotation[1] ?? 0
    }, ids.rotor)
    await page.waitForTimeout(1_400)
    const rotation2 = await page.evaluate((nodeId) => {
      const runtime = (
        window as Window & {
          __pascalDynamicPreviewRuntime?: {
            entries?: Array<{ nodeId: string; rotation: [number, number, number] }>
          }
        }
      ).__pascalDynamicPreviewRuntime
      return runtime?.entries?.find((entry) => entry.nodeId === nodeId)?.rotation[1] ?? 0
    }, ids.rotor)

    expect(Math.abs(rotation2 - rotation1)).toBeGreaterThan(0.25)
  } finally {
    await page
      .evaluate(() => {
        const bridge = (
          window as Window & {
            __pascalFactoryE2e?: FactoryE2eBridge
          }
        ).__pascalFactoryE2e
        bridge?.setPreviewMode(false)
      })
      .catch(() => undefined)
    await request.delete(`/api/scenes/${sceneId}`).catch(() => undefined)
  }

  expect(
    consoleErrors.filter(
      (line) => !line.includes('favicon') && !line.includes('ERR_CONNECTION_RESET'),
    ),
  ).toEqual([])
})

test('data toolbar opens live data source panel from the editor canvas', async ({
  page,
  request,
}) => {
  const sceneId = await createScene(request)

  try {
    await page.goto(`/scene/${sceneId}?factoryE2e=1`, {
      waitUntil: 'domcontentloaded',
      timeout: 180_000,
    })
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 60_000 })

    await page.getByTestId('action-menu-control-data').click({ timeout: 30_000 })

    await expect(page.getByTestId('live-data-panel')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('\u5b9e\u65f6\u6570\u636e\u6e90', { exact: true })).toBeVisible()
    await expect(page.getByText(/seq/).last()).toBeVisible()
  } finally {
    await request.delete(`/api/scenes/${sceneId}`).catch(() => undefined)
  }
})

test('data widget renders websocket values from the shared live data store', async ({
  page,
  request,
}) => {
  const sceneId = await createScene(request)

  try {
    await page.goto(`/scene/${sceneId}?factoryE2e=1`, {
      waitUntil: 'domcontentloaded',
      timeout: 180_000,
    })
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 60_000 })
    await expectFactoryBridge(page)
    await setIsometricView(page)

    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const bridge = (
              window as Window & {
                __pascalFactoryE2e?: FactoryE2eBridge
              }
            ).__pascalFactoryE2e
            return {
              pipe: bridge?.liveDataValue('factory.pipe.flow'),
              temperature: bridge?.liveDataValue('factory.machine.temperature'),
              fan: bridge?.liveDataValue('factory.fan.speed'),
            }
          }),
        { timeout: 30_000 },
      )
      .toEqual({
        pipe: expect.any(Number),
        temperature: expect.any(Number),
        fan: expect.any(Number),
      })

    const badgeWidget = page.getByRole('button', { name: 'Pipe Flow Data Widget' })
    await expect(badgeWidget).toBeVisible({ timeout: 30_000 })
    await expect(badgeWidget).toContainText('\u7ba1\u9053\u6d41\u91cf', { timeout: 30_000 })
    await expect(badgeWidget).toContainText('m\u00b3/h', { timeout: 30_000 })

    const cardWidget = page.getByRole('button', { name: 'Temperature Card Data Widget' })
    await expect(cardWidget).toBeVisible({ timeout: 30_000 })
    await expect(cardWidget).toContainText('Temperature Card', { timeout: 30_000 })
    await expect(cardWidget).toContainText('\u8bbe\u5907\u6e29\u5ea6', { timeout: 30_000 })
    await expect(cardWidget).toContainText('\u00b0C', { timeout: 30_000 })

    const chartWidget = page.getByRole('button', { name: 'Fan Speed Chart Data Widget' })
    await expect(chartWidget).toBeVisible({ timeout: 30_000 })
    await expect(chartWidget).toContainText('Fan Speed Chart', { timeout: 30_000 })
    await expect(chartWidget).toContainText('\u98ce\u673a\u8f6c\u901f', { timeout: 30_000 })
    await expect(chartWidget).toContainText('%', { timeout: 30_000 })

    await page.evaluate((nodeId) => {
      const bridge = (
        window as Window & {
          __pascalFactoryE2e?: FactoryE2eBridge
        }
      ).__pascalFactoryE2e
      bridge?.selectNode(nodeId)
    }, ids.dataWidget)

    await expect(page.getByText('Pipe Flow Data Widget', { exact: true })).toBeVisible({
      timeout: 10_000,
    })
    await expect
      .poll(
        () =>
          page.evaluate((nodeIds) => {
            const bridge = (
              window as Window & {
                __pascalFactoryE2e?: FactoryE2eBridge
              }
            ).__pascalFactoryE2e
            const nodes = bridge?.sceneNodes() as Record<string, SceneNode> | undefined
            return {
              badge: nodes?.[nodeIds.dataWidget]?.dataKey,
              card: nodes?.[nodeIds.dataWidgetCard]?.dataKey,
              chart: nodes?.[nodeIds.dataWidgetChart]?.dataKey,
            }
          }, ids),
        { timeout: 10_000 },
      )
      .toEqual({
        badge: 'factory.pipe.flow',
        card: 'factory.machine.temperature',
        chart: 'factory.fan.speed',
      })
  } finally {
    await request.delete(`/api/scenes/${sceneId}`).catch(() => undefined)
  }
})

test('AI data binding applies alarm pulse and preview runtime animates scale', async ({
  page,
  request,
}) => {
  const sceneId = await createScene(request)

  try {
    await page.addInitScript(() => {
      window.localStorage.clear()
    })
    await page.goto(`/scene/${sceneId}?factoryE2e=1`, {
      waitUntil: 'domcontentloaded',
      timeout: 180_000,
    })
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 60_000 })
    await expectFactoryBridge(page)

    await page.evaluate((nodeId) => {
      const bridge = (
        window as Window & {
          __pascalFactoryE2e?: FactoryE2eBridge
        }
      ).__pascalFactoryE2e
      bridge?.selectNode(nodeId)
    }, ids.reference)

    await page.getByTestId('sidebar-tab-ai').click()
    await expect(page.getByTestId('factory-chat-input')).toBeVisible({ timeout: 30_000 })
    await page
      .getByTestId('factory-chat-input')
      .fill('pulse the selected equipment when alarm count is active')
    await page.getByTestId('factory-chat-send').click()

    await expect(page.getByTestId('generation-plan-preview-bind-live-data')).toBeVisible({
      timeout: 30_000,
    })
    await page.getByTestId('generation-plan-preview-apply-bind-live-data').click()
    await expect(page.getByText('Bound Static reference beam Alarm pulse')).toBeVisible({
      timeout: 30_000,
    })

    await expect
      .poll(
        () =>
          page.evaluate((nodeId) => {
            const bridge = (
              window as Window & {
                __pascalFactoryE2e?: FactoryE2eBridge
              }
            ).__pascalFactoryE2e
            const node = bridge?.sceneNodes()[nodeId] as SceneNode | undefined
            const bindings = node?.metadata?.dynamicBindings as
              | Array<Record<string, unknown>>
              | undefined
            return bindings?.map((binding) => ({
              id: binding.id,
              type: binding.type,
              path: binding.path,
              scaleEffect: binding.scaleEffect,
            }))
          }, ids.reference),
        { timeout: 30_000 },
      )
      .toContainEqual({
        id: `semantic_live_${ids.reference}_alarm-pulse`,
        type: 'scale',
        path: 'alarm.count',
        scaleEffect: 'alarmPulse',
      })

    await page.evaluate(() => {
      const bridge = (
        window as Window & {
          __pascalFactoryE2e?: FactoryE2eBridge
        }
      ).__pascalFactoryE2e
      bridge?.setPreviewMode(true)
    })

    await expect
      .poll(
        () =>
          page.evaluate((nodeId) => {
            const runtime = (
              window as Window & {
                __pascalDynamicPreviewRuntime?: {
                  entries?: Array<{ nodeId: string; scale: [number, number, number] }>
                }
              }
            ).__pascalDynamicPreviewRuntime
            return runtime?.entries?.find((entry) => entry.nodeId === nodeId)?.scale ?? null
          }, ids.reference),
        { timeout: 30_000 },
      )
      .not.toBeNull()

    await expect
      .poll(
        () =>
          page.evaluate((nodeId) => {
            const runtime = (
              window as Window & {
                __pascalDynamicPreviewRuntime?: {
                  entries?: Array<{ nodeId: string; scale: [number, number, number] }>
                }
              }
            ).__pascalDynamicPreviewRuntime
            const scale = runtime?.entries?.find((entry) => entry.nodeId === nodeId)?.scale
            return scale ? Math.max(...scale) : 1
          }, ids.reference),
        { timeout: 30_000 },
      )
      .toBeGreaterThan(1.02)
  } finally {
    await page
      .evaluate(() => {
        const bridge = (
          window as Window & {
            __pascalFactoryE2e?: FactoryE2eBridge
          }
        ).__pascalFactoryE2e
        bridge?.setPreviewMode(false)
      })
      .catch(() => undefined)
    await request.delete(`/api/scenes/${sceneId}`).catch(() => undefined)
  }
})

test('dynamic inspector binds a selected node to websocket data and saves metadata', async ({
  page,
  request,
}) => {
  const sceneId = await createScene(request)

  try {
    await page.goto(`/scene/${sceneId}?factoryE2e=1`, {
      waitUntil: 'domcontentloaded',
      timeout: 180_000,
    })
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 60_000 })
    await expectFactoryBridge(page)

    await page.evaluate((nodeId) => {
      const bridge = (
        window as Window & {
          __pascalFactoryE2e?: FactoryE2eBridge
        }
      ).__pascalFactoryE2e
      bridge?.selectNode(nodeId)
    }, ids.rotor)

    await page.getByTestId('inspector-tab-dynamic').click({ timeout: 30_000 })
    await expect(page.getByTestId('dynamic-inspector')).toBeVisible({ timeout: 10_000 })
    await page.getByTestId('dynamic-add-recommended').click()

    const pathSelect = page.getByTestId('dynamic-binding-path-select').last()
    await expect(pathSelect).toBeVisible({ timeout: 10_000 })
    await pathSelect.selectOption('factory.fan.speed')

    await expect
      .poll(
        () =>
          page.evaluate((nodeId) => {
            const bridge = (
              window as Window & {
                __pascalFactoryE2e?: FactoryE2eBridge
              }
            ).__pascalFactoryE2e
            const node = bridge?.sceneNodes()[nodeId] as SceneNode | undefined
            const bindings = node?.metadata?.dynamicBindings as
              | Array<Record<string, unknown>>
              | undefined
            const binding = bindings?.find(
              (item) => item.type === 'speed' && item.path === 'factory.fan.speed',
            )
            return binding
              ? {
                  type: binding.type,
                  path: binding.path,
                  axis: binding.axis,
                  speedRange: binding.speedRange,
                }
              : null
          }, ids.rotor),
        { timeout: 10_000 },
      )
      .toEqual({ type: 'speed', path: 'factory.fan.speed', axis: 'y', speedRange: [0, 6] })
  } finally {
    await request.delete(`/api/scenes/${sceneId}`).catch(() => undefined)
  }
})

test('dynamic inspector groups binding settings without inline status clutter', async ({
  page,
  request,
}) => {
  const sceneId = await createScene(request)

  const selectNode = (nodeId: string) =>
    page.evaluate((targetNodeId) => {
      const bridge = (
        window as Window & {
          __pascalFactoryE2e?: FactoryE2eBridge
        }
      ).__pascalFactoryE2e
      bridge?.selectNode(targetNodeId)
    }, nodeId)

  try {
    await page.goto(`/scene/${sceneId}?factoryE2e=1`, {
      waitUntil: 'domcontentloaded',
      timeout: 180_000,
    })
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 60_000 })
    await expectFactoryBridge(page)

    await selectNode(ids.invalidRotate)
    await page.getByTestId('inspector-tab-dynamic').click({ timeout: 30_000 })
    await expect(page.getByTestId('dynamic-inspector')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByTestId('dynamic-section-data-mapping').first()).toBeVisible()
    await expect(page.getByTestId('dynamic-section-motion').first()).toBeVisible()
    await expect(page.getByTestId('dynamic-section-validation').first()).toBeVisible()
    await expect(page.getByText('\u6821\u9a8c\u63d0\u793a')).toHaveCount(0)
    await expect(
      page.getByTestId('dynamic-validation-error').filter({ hasText: /factory\.missing\.speed/ }),
    ).toBeVisible()
    await expect(page.getByTestId('dynamic-validation-error')).toHaveCount(3)
    await expect(page.getByText('\u5f53\u524d\u503c')).toHaveCount(0)

    await selectNode(ids.invalidConveyor)
    await page.getByTestId('inspector-tab-dynamic').click({ timeout: 30_000 })
    await expect(page.getByTestId('dynamic-conveyor-unavailable')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByTestId('dynamic-validation-warning')).toBeVisible()
    await expect(page.getByTestId('dynamic-validation-error')).toHaveCount(2)
  } finally {
    await request.delete(`/api/scenes/${sceneId}`).catch(() => undefined)
  }
})

test('visible dynamics use explicit industrial conditions', async ({ page, request }) => {
  const sceneId = await createScene(request)

  try {
    await page.goto(`/scene/${sceneId}?factoryE2e=1`, {
      waitUntil: 'domcontentloaded',
      timeout: 180_000,
    })
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 60_000 })
    await expectFactoryBridge(page)

    await page.evaluate((nodeId) => {
      const bridge = (
        window as Window & {
          __pascalFactoryE2e?: FactoryE2eBridge
        }
      ).__pascalFactoryE2e
      bridge?.selectNode(nodeId)
    }, ids.visibleThreshold)
    await page.getByTestId('inspector-tab-dynamic').click({ timeout: 30_000 })
    await expect(page.getByTestId('dynamic-visible-condition')).toBeVisible({ timeout: 10_000 })
    const conditionOptions = await page
      .getByTestId('dynamic-visible-condition-select')
      .locator('option')
      .evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value))
    expect(conditionOptions).toEqual(['truthy', 'greaterThan', 'lessThan', 'equals'])
    await expect(page.getByTestId('dynamic-visible-condition-select')).toHaveValue('greaterThan')

    await page.evaluate(() => {
      const bridge = (
        window as Window & {
          __pascalFactoryE2e?: FactoryE2eBridge
        }
      ).__pascalFactoryE2e
      bridge?.setPreviewMode(true)
    })

    await expect
      .poll(
        () =>
          page.evaluate((targetIds) => {
            const runtime = (
              window as Window & {
                __pascalDynamicPreviewRuntime?: {
                  entries?: Array<{ nodeId: string; visible: boolean }>
                }
              }
            ).__pascalDynamicPreviewRuntime
            const byId = new Map(runtime?.entries?.map((entry) => [entry.nodeId, entry.visible]))
            return {
              bool: byId.get(targetIds.visibleBool),
              threshold: byId.get(targetIds.visibleThreshold),
              equals: byId.get(targetIds.visibleEquals),
            }
          }, ids),
        { timeout: 30_000 },
      )
      .toEqual({ bool: true, threshold: true, equals: true })

    await page.getByTestId('preview-exit-button').click({ timeout: 10_000 })
  } finally {
    await page
      .evaluate(() => {
        const bridge = (
          window as Window & {
            __pascalFactoryE2e?: FactoryE2eBridge
          }
        ).__pascalFactoryE2e
        bridge?.setPreviewMode(false)
      })
      .catch(() => undefined)
    await request.delete(`/api/scenes/${sceneId}`).catch(() => undefined)
  }
})

test('move dynamics support follow mode and rolling movement', async ({ page, request }) => {
  const sceneId = await createScene(request)

  try {
    await page.goto(`/scene/${sceneId}?factoryE2e=1`, {
      waitUntil: 'domcontentloaded',
      timeout: 180_000,
    })
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 60_000 })
    await expectFactoryBridge(page)

    await page.evaluate((nodeId) => {
      const bridge = (
        window as Window & {
          __pascalFactoryE2e?: FactoryE2eBridge
        }
      ).__pascalFactoryE2e
      bridge?.selectNode(nodeId)
    }, ids.moveRoll)
    await page.getByTestId('inspector-tab-dynamic').click({ timeout: 30_000 })
    await expect(page.getByTestId('dynamic-move-motion-mode-select')).toBeVisible({
      timeout: 10_000,
    })
    await expect(page.getByTestId('dynamic-move-style-select')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByTestId('dynamic-move-motion-mode-select')).toHaveValue('follow')
    await expect(page.getByTestId('dynamic-move-style-select')).toHaveValue('roll')

    await page.evaluate(() => {
      const bridge = (
        window as Window & {
          __pascalFactoryE2e?: FactoryE2eBridge
        }
      ).__pascalFactoryE2e
      bridge?.setPreviewMode(true)
    })

    await expect
      .poll(
        () =>
          page.evaluate((nodeId) => {
            const runtime = (
              window as Window & {
                __pascalDynamicPreviewRuntime?: {
                  entries?: Array<{
                    nodeId: string
                    position: [number, number, number]
                    rotation: [number, number, number]
                  }>
                }
              }
            ).__pascalDynamicPreviewRuntime
            const entry = runtime?.entries?.find((item) => item.nodeId === nodeId)
            return entry ? { x: entry.position[0], rollZ: entry.rotation[2] } : null
          }, ids.moveRoll),
        { timeout: 30_000 },
      )
      .toEqual({ x: -0.7, rollZ: 2 })

    await page.getByTestId('preview-exit-button').click({ timeout: 10_000 })
  } finally {
    await page
      .evaluate(() => {
        const bridge = (
          window as Window & {
            __pascalFactoryE2e?: FactoryE2eBridge
          }
        ).__pascalFactoryE2e
        bridge?.setPreviewMode(false)
      })
      .catch(() => undefined)
    await request.delete(`/api/scenes/${sceneId}`).catch(() => undefined)
  }
})

test('blink color and scale dynamics use industrial condition rules in preview', async ({
  page,
  request,
}) => {
  const sceneId = await createScene(request)

  try {
    await page.goto(`/scene/${sceneId}?factoryE2e=1`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    })
    await expectFactoryBridge(page)

    await page.evaluate(() => {
      const bridge = (
        window as Window & {
          __pascalFactoryE2e?: { setPreviewMode: (enabled: boolean) => void }
        }
      ).__pascalFactoryE2e
      bridge?.setPreviewMode(true)
    })

    await expect
      .poll(
        async () =>
          page.evaluate((targetIds) => {
            const runtime = (
              window as Window & {
                __pascalDynamicPreviewRuntime?: {
                  entries?: Array<{
                    nodeId: string
                    visible: boolean
                    scale: [number, number, number]
                    materialColors?: Array<{ color: string | null }>
                  }>
                }
              }
            ).__pascalDynamicPreviewRuntime
            const byId = new Map(runtime?.entries?.map((entry) => [entry.nodeId, entry]))
            return {
              color: byId.get(targetIds.conditionalColor)?.materialColors?.[0]?.color ?? null,
              scaleX: byId.get(targetIds.conditionalScale)?.scale[0] ?? null,
            }
          }, ids),
        { timeout: 30_000 },
      )
      .toEqual({ color: '#ff0000', scaleX: 1.4 })

    const blinkSamples = await page.evaluate(async (targetIds) => {
      const values: boolean[] = []
      for (let index = 0; index < 12; index += 1) {
        await new Promise((resolve) => setTimeout(resolve, 120))
        const runtime = (
          window as Window & {
            __pascalDynamicPreviewRuntime?: {
              entries?: Array<{ nodeId: string; visible: boolean }>
            }
          }
        ).__pascalDynamicPreviewRuntime
        const entry = runtime?.entries?.find((item) => item.nodeId === targetIds.conditionalBlink)
        if (typeof entry?.visible === 'boolean') values.push(entry.visible)
      }
      return values
    }, ids)
    expect(blinkSamples).toContain(true)
    expect(blinkSamples).toContain(false)

    await page.getByTestId('preview-exit-button').click({ timeout: 10_000 })
  } finally {
    await page
      .evaluate(() => {
        const bridge = (
          window as Window & {
            __pascalFactoryE2e?: { setPreviewMode: (enabled: boolean) => void }
          }
        ).__pascalFactoryE2e
        bridge?.setPreviewMode(false)
      })
      .catch(() => undefined)
    await request.delete(`/api/scenes/${sceneId}`).catch(() => undefined)
  }
})

test('color gradient and alarm pulse scale run in preview', async ({ page, request }) => {
  const sceneId = await createScene(request)

  try {
    await page.goto(`/scene/${sceneId}?factoryE2e=1`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    })
    await expectFactoryBridge(page)

    await page.evaluate(() => {
      const bridge = (
        window as Window & {
          __pascalFactoryE2e?: { setPreviewMode: (enabled: boolean) => void }
        }
      ).__pascalFactoryE2e
      bridge?.setPreviewMode(true)
    })

    await expect
      .poll(
        async () =>
          page.evaluate((targetIds) => {
            const runtime = (
              window as Window & {
                __pascalDynamicPreviewRuntime?: {
                  entries?: Array<{
                    nodeId: string
                    scale: [number, number, number]
                    materialColors?: Array<{ color: string | null }>
                  }>
                }
              }
            ).__pascalDynamicPreviewRuntime
            const byId = new Map(runtime?.entries?.map((entry) => [entry.nodeId, entry]))
            return {
              gradientColor: byId.get(targetIds.gradientColor)?.materialColors?.[0]?.color ?? null,
              scaleX: byId.get(targetIds.alarmScale)?.scale[0] ?? null,
            }
          }, ids),
        { timeout: 30_000 },
      )
      .toMatchObject({ gradientColor: '#ff0000' })

    const scaleSamples = await page.evaluate(async (targetIds) => {
      const values: number[] = []
      for (let index = 0; index < 12; index += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100))
        const runtime = (
          window as Window & {
            __pascalDynamicPreviewRuntime?: {
              entries?: Array<{ nodeId: string; scale: [number, number, number] }>
            }
          }
        ).__pascalDynamicPreviewRuntime
        const entry = runtime?.entries?.find((item) => item.nodeId === targetIds.alarmScale)
        if (typeof entry?.scale?.[0] === 'number') values.push(entry.scale[0])
      }
      return values
    }, ids)
    expect(Math.max(...scaleSamples)).toBeGreaterThan(1.25)
    expect(Math.max(...scaleSamples) - Math.min(...scaleSamples)).toBeGreaterThan(0.1)
  } finally {
    await page
      .evaluate(() => {
        const bridge = (
          window as Window & {
            __pascalFactoryE2e?: { setPreviewMode: (enabled: boolean) => void }
          }
        ).__pascalFactoryE2e
        bridge?.setPreviewMode(false)
      })
      .catch(() => undefined)
    await request.delete(`/api/scenes/${sceneId}`).catch(() => undefined)
  }
})

test('dynamic runtime only animates in preview mode and restores on exit', async ({
  page,
  request,
}) => {
  const sceneId = await createScene(request)

  const readRotationY = (nodeId: string) =>
    page.evaluate((targetNodeId) => {
      const runtime = (
        window as Window & {
          __pascalDynamicPreviewRuntime?: {
            entries?: Array<{ nodeId: string; rotation: [number, number, number] }>
          }
        }
      ).__pascalDynamicPreviewRuntime
      const runtimeEntry = runtime?.entries?.find((entry) => entry.nodeId === targetNodeId)
      if (runtimeEntry) return runtimeEntry.rotation[1]

      const bridge = (
        window as Window & {
          __pascalFactoryE2e?: FactoryE2eBridge
        }
      ).__pascalFactoryE2e
      return bridge?.nodeTransform(targetNodeId)?.rotation[1] ?? null
    }, nodeId)

  const readObjectRotationY = (nodeId: string) =>
    page.evaluate((targetNodeId) => {
      const bridge = (
        window as Window & {
          __pascalFactoryE2e?: FactoryE2eBridge
        }
      ).__pascalFactoryE2e
      return bridge?.nodeTransform(targetNodeId)?.rotation[1] ?? null
    }, nodeId)

  const setPreviewMode = (enabled: boolean) =>
    page.evaluate((nextEnabled) => {
      const bridge = (
        window as Window & {
          __pascalFactoryE2e?: FactoryE2eBridge
        }
      ).__pascalFactoryE2e
      bridge?.setPreviewMode(nextEnabled)
    }, enabled)

  try {
    await page.goto(`/scene/${sceneId}?factoryE2e=1`, {
      waitUntil: 'domcontentloaded',
      timeout: 180_000,
    })
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 60_000 })
    await expectFactoryBridge(page)
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const bridge = (
              window as Window & {
                __pascalFactoryE2e?: FactoryE2eBridge
              }
            ).__pascalFactoryE2e
            return bridge?.liveDataValue('factory.fan.speed')
          }),
        { timeout: 30_000 },
      )
      .not.toBeUndefined()

    await expect.poll(() => readRotationY(ids.rotor), { timeout: 30_000 }).not.toBeNull()
    const designStart = (await readRotationY(ids.rotor)) ?? 0
    await page.waitForTimeout(1_200)
    const designAfter = (await readRotationY(ids.rotor)) ?? 0
    expect(Math.abs(designAfter - designStart)).toBeLessThan(0.001)

    await setPreviewMode(true)
    await expect
      .poll(
        () =>
          page.evaluate((nodeId) => {
            const runtime = (
              window as Window & {
                __pascalDynamicPreviewRuntime?: {
                  entries?: Array<{ nodeId: string; rotation: [number, number, number] }>
                }
              }
            ).__pascalDynamicPreviewRuntime
            return runtime?.entries?.some((entry) => entry.nodeId === nodeId) ?? false
          }, ids.rotor),
        { timeout: 30_000 },
      )
      .toBe(true)
    await page.waitForTimeout(800)
    const previewStart = (await readRotationY(ids.rotor)) ?? 0
    await page.waitForTimeout(1_400)
    const previewAfter = (await readRotationY(ids.rotor)) ?? 0
    expect(Math.abs(previewAfter - previewStart)).toBeGreaterThan(0.25)

    await page.getByTestId('preview-exit-button').click({ timeout: 10_000 })
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            Boolean(
              (window as Window & { __pascalDynamicPreviewRuntime?: unknown })
                .__pascalDynamicPreviewRuntime,
            ),
          ),
        { timeout: 10_000 },
      )
      .toBe(false)
    const restored = (await readObjectRotationY(ids.rotor)) ?? 0
    expect(Math.abs(restored - designStart)).toBeLessThan(0.001)
  } finally {
    await setPreviewMode(false).catch(() => undefined)
    await request.delete(`/api/scenes/${sceneId}`).catch(() => undefined)
  }
})

test('conveyor specialty settings only show for conveyor nodes and preview generates cargo clones', async ({
  page,
  request,
}) => {
  const sceneId = await createScene(request)

  const setPreviewMode = (enabled: boolean) =>
    page.evaluate((nextEnabled) => {
      const bridge = (
        window as Window & {
          __pascalFactoryE2e?: FactoryE2eBridge
        }
      ).__pascalFactoryE2e
      bridge?.setPreviewMode(nextEnabled)
    }, enabled)

  try {
    await page.goto(`/scene/${sceneId}?factoryE2e=1`, {
      waitUntil: 'domcontentloaded',
      timeout: 180_000,
    })
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 60_000 })
    await expectFactoryBridge(page)
    await setIsometricView(page)
    await page
      .getByText(/Rendering/i)
      .waitFor({ state: 'hidden', timeout: 60_000 })
      .catch(() => undefined)

    await page.evaluate((nodeId) => {
      const bridge = (
        window as Window & {
          __pascalFactoryE2e?: FactoryE2eBridge
        }
      ).__pascalFactoryE2e
      bridge?.selectNode(nodeId)
    }, ids.rotor)
    await page.getByTestId('inspector-tab-dynamic').click({ timeout: 30_000 })
    await expect(page.getByTestId('dynamic-inspector')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByTestId('dynamic-conveyor-settings')).toHaveCount(0)
    const rotorDynamicOptions = await page
      .getByTestId('dynamic-binding-type-select')
      .first()
      .locator('option')
      .evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value))
    expect(rotorDynamicOptions).not.toContain('conveyorFlow')

    await page.evaluate((nodeId) => {
      const bridge = (
        window as Window & {
          __pascalFactoryE2e?: FactoryE2eBridge
        }
      ).__pascalFactoryE2e
      bridge?.selectNode(nodeId)
    }, ids.conveyor)
    await page.getByTestId('inspector-tab-dynamic').click({ timeout: 30_000 })
    await expect(page.getByTestId('dynamic-conveyor-settings')).toBeVisible({ timeout: 10_000 })
    const conveyorDynamicOptions = await page
      .getByTestId('dynamic-binding-type-select')
      .first()
      .locator('option')
      .evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value))
    expect(conveyorDynamicOptions).toContain('conveyorFlow')

    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const bridge = (
              window as Window & {
                __pascalFactoryE2e?: FactoryE2eBridge
              }
            ).__pascalFactoryE2e
            return bridge?.liveDataValue('factory.conveyor.speed')
          }),
        { timeout: 30_000 },
      )
      .not.toBeUndefined()

    await setPreviewMode(true)
    await expect
      .poll(
        () =>
          page.evaluate((nodeId) => {
            const runtime = (
              window as Window & {
                __pascalDynamicPreviewRuntime?: {
                  entries?: Array<{
                    nodeId: string
                    conveyorCloneCount?: number
                    conveyorClonePositions?: Array<[number, number, number]>
                  }>
                }
              }
            ).__pascalDynamicPreviewRuntime
            const entry = runtime?.entries?.find((item) => item.nodeId === nodeId)
            return entry?.conveyorCloneCount ?? 0
          }, ids.conveyor),
        { timeout: 30_000 },
      )
      .toBeGreaterThan(1)

    const firstPosition = await page.evaluate((nodeId) => {
      const runtime = (
        window as Window & {
          __pascalDynamicPreviewRuntime?: {
            entries?: Array<{
              nodeId: string
              conveyorClonePositions?: Array<[number, number, number]>
            }>
          }
        }
      ).__pascalDynamicPreviewRuntime
      return (
        runtime?.entries?.find((entry) => entry.nodeId === nodeId)
          ?.conveyorClonePositions?.[0]?.[0] ?? null
      )
    }, ids.conveyor)
    await page.waitForTimeout(1_200)
    const nextPosition = await page.evaluate((nodeId) => {
      const runtime = (
        window as Window & {
          __pascalDynamicPreviewRuntime?: {
            entries?: Array<{
              nodeId: string
              conveyorClonePositions?: Array<[number, number, number]>
            }>
          }
        }
      ).__pascalDynamicPreviewRuntime
      return (
        runtime?.entries?.find((entry) => entry.nodeId === nodeId)
          ?.conveyorClonePositions?.[0]?.[0] ?? null
      )
    }, ids.conveyor)
    expect(firstPosition).not.toBeNull()
    expect(nextPosition).not.toBeNull()
    expect(Math.abs((nextPosition ?? 0) - (firstPosition ?? 0))).toBeGreaterThan(0.2)

    await page.getByTestId('preview-exit-button').click({ timeout: 10_000 })
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            Boolean(
              (window as Window & { __pascalDynamicPreviewRuntime?: unknown })
                .__pascalDynamicPreviewRuntime,
            ),
          ),
        { timeout: 10_000 },
      )
      .toBe(false)
  } finally {
    await setPreviewMode(false).catch(() => undefined)
  }
})

test('industrial specialty dynamics expose scoped options and run in preview', async ({
  page,
  request,
}) => {
  const sceneId = await createScene(request)

  const setPreviewMode = (enabled: boolean) =>
    page.evaluate((nextEnabled) => {
      const bridge = (
        window as Window & {
          __pascalFactoryE2e?: FactoryE2eBridge
        }
      ).__pascalFactoryE2e
      bridge?.setPreviewMode(nextEnabled)
    }, enabled)

  const selectNode = (nodeId: string) =>
    page.evaluate((targetNodeId) => {
      const bridge = (
        window as Window & {
          __pascalFactoryE2e?: FactoryE2eBridge
        }
      ).__pascalFactoryE2e
      bridge?.selectNode(targetNodeId)
    }, nodeId)

  const dynamicOptions = () =>
    page
      .getByTestId('dynamic-binding-type-select')
      .first()
      .locator('option')
      .evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value))

  try {
    await page.goto(`/scene/${sceneId}?factoryE2e=1`, {
      waitUntil: 'domcontentloaded',
      timeout: 180_000,
    })
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 60_000 })
    await expectFactoryBridge(page)
    await setIsometricView(page)
    await page
      .getByText(/Rendering/i)
      .waitFor({ state: 'hidden', timeout: 60_000 })
      .catch(() => undefined)

    await selectNode(ids.pipe)
    await page.getByTestId('inspector-tab-dynamic').click({ timeout: 30_000 })
    await expect(page.getByTestId('dynamic-inspector')).toBeVisible({ timeout: 10_000 })
    expect(await dynamicOptions()).toContain('flow')

    await selectNode(ids.tank)
    await page.getByTestId('inspector-tab-dynamic').click({ timeout: 30_000 })
    expect(await dynamicOptions()).toContain('level')

    await selectNode(ids.valve)
    await page.getByTestId('inspector-tab-dynamic').click({ timeout: 30_000 })
    expect(await dynamicOptions()).toContain('openClose')

    await selectNode(ids.light)
    await page.getByTestId('inspector-tab-dynamic').click({ timeout: 30_000 })
    const lightOptions = await dynamicOptions()
    expect(lightOptions).toContain('brightness')
    expect(lightOptions).not.toContain('conveyorFlow')

    await setPreviewMode(true)
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const runtime = (
              window as Window & {
                __pascalDynamicPreviewRuntime?: {
                  entries?: Array<{ nodeId: string }>
                }
              }
            ).__pascalDynamicPreviewRuntime
            return runtime?.entries?.map((entry) => entry.nodeId).sort() ?? []
          }),
        { timeout: 30_000 },
      )
      .toEqual(
        expect.arrayContaining([
          ids.pipe,
          ids.nativePipe,
          ids.tank,
          ids.nativeTank,
          ids.valve,
          ids.light,
        ]),
      )

    const runtimeState = await page.evaluate((targetIds) => {
      const runtime = (
        window as Window & {
          __pascalDynamicPreviewRuntime?: {
            entries?: Array<{
              nodeId: string
              rotation: [number, number, number]
              scale: [number, number, number]
              materialColors?: Array<{ color: string | null }>
              flowArrowCount?: number
              flowArrowPositions?: Array<[number, number, number]>
              flowFill?: {
                position: [number, number, number]
                scale: [number, number, number]
                visible: boolean
                bounds?: {
                  min: [number, number, number]
                  max: [number, number, number]
                }
              } | null
              levelFill?: {
                position: [number, number, number]
                scale: [number, number, number]
                visible: boolean
                wave?: boolean
                castShadow?: boolean
                receiveShadow?: boolean
              } | null
              valveHandle?: {
                position: [number, number, number]
                rotation: [number, number, number]
                visible: boolean
              } | null
            }>
          }
        }
      ).__pascalDynamicPreviewRuntime
      const byId = new Map(runtime?.entries?.map((entry) => [entry.nodeId, entry]))
      return {
        pipeColor: byId.get(targetIds.pipe)?.materialColors?.[0]?.color ?? null,
        pipeArrowCount: byId.get(targetIds.pipe)?.flowArrowCount ?? 0,
        pipeFirstArrowX: byId.get(targetIds.pipe)?.flowArrowPositions?.[0]?.[0] ?? null,
        nativePipeArrowCount: byId.get(targetIds.nativePipe)?.flowArrowCount ?? 0,
        nativePipeFirstArrowX: byId.get(targetIds.nativePipe)?.flowArrowPositions?.[0]?.[0] ?? null,
        nativePipeFirstArrowY: byId.get(targetIds.nativePipe)?.flowArrowPositions?.[0]?.[1] ?? null,
        nativePipeFlowFill: byId.get(targetIds.nativePipe)?.flowFill ?? null,
        tankLevelFill: byId.get(targetIds.tank)?.levelFill ?? null,
        nativeTankLevelFill: byId.get(targetIds.nativeTank)?.levelFill ?? null,
        valveRotationY: byId.get(targetIds.valve)?.rotation[1] ?? null,
        valveHandle: byId.get(targetIds.valve)?.valveHandle ?? null,
        lightColor: byId.get(targetIds.light)?.materialColors?.[0]?.color ?? null,
      }
    }, ids)

    expect(runtimeState.pipeColor).not.toBeNull()
    expect(runtimeState.pipeArrowCount).toBeGreaterThan(0)
    expect(runtimeState.pipeFirstArrowX).not.toBeNull()
    expect(runtimeState.nativePipeArrowCount).toBeGreaterThan(0)
    expect(runtimeState.nativePipeFirstArrowX).not.toBeNull()
    expect(Math.abs((runtimeState.nativePipeFirstArrowY ?? 0) - 1.06)).toBeLessThan(0.08)
    expect(runtimeState.nativePipeFlowFill?.visible).toBe(true)
    const nativePipeFlowFillBounds = runtimeState.nativePipeFlowFill?.bounds
    const nativePipeFlowFillCenterY = nativePipeFlowFillBounds
      ? (nativePipeFlowFillBounds.min[1] + nativePipeFlowFillBounds.max[1]) / 2
      : null
    expect(Math.abs((nativePipeFlowFillCenterY ?? 0) - 1)).toBeLessThan(0.02)
    expect(runtimeState.lightColor).not.toBeNull()
    expect(runtimeState.tankLevelFill?.visible).toBe(true)
    expect(Math.abs((runtimeState.tankLevelFill?.scale[1] ?? 0) - 0.4)).toBeLessThan(0.001)
    expect(runtimeState.nativeTankLevelFill?.visible).toBe(true)
    expect(runtimeState.nativeTankLevelFill?.wave).toBe(true)
    expect(runtimeState.nativeTankLevelFill?.castShadow).toBe(true)
    expect(runtimeState.nativeTankLevelFill?.receiveShadow).toBe(true)
    expect(runtimeState.valveRotationY).not.toBeNull()
    expect(Math.abs((runtimeState.valveRotationY ?? 0) - 0.8)).toBeLessThan(0.001)
    expect(runtimeState.valveHandle?.visible).toBe(true)
    expect(Math.abs((runtimeState.valveHandle?.rotation[1] ?? 0) - 0.8)).toBeLessThan(0.001)

    await page.waitForTimeout(1_000)
    const movedArrowX = await page.evaluate((targetIds) => {
      const runtime = (
        window as Window & {
          __pascalDynamicPreviewRuntime?: {
            entries?: Array<{
              nodeId: string
              flowArrowPositions?: Array<[number, number, number]>
            }>
          }
        }
      ).__pascalDynamicPreviewRuntime
      return (
        runtime?.entries?.find((entry) => entry.nodeId === targetIds.pipe)
          ?.flowArrowPositions?.[0]?.[0] ?? null
      )
    }, ids)
    expect(movedArrowX).not.toBeNull()
    expect(Math.abs((movedArrowX ?? 0) - (runtimeState.pipeFirstArrowX ?? 0))).toBeGreaterThan(0.05)
    const movedNativeArrowX = await page.evaluate((targetIds) => {
      const runtime = (
        window as Window & {
          __pascalDynamicPreviewRuntime?: {
            entries?: Array<{
              nodeId: string
              flowArrowPositions?: Array<[number, number, number]>
            }>
          }
        }
      ).__pascalDynamicPreviewRuntime
      return (
        runtime?.entries?.find((entry) => entry.nodeId === targetIds.nativePipe)
          ?.flowArrowPositions?.[0]?.[0] ?? null
      )
    }, ids)
    expect(movedNativeArrowX).not.toBeNull()
    expect(
      Math.abs((movedNativeArrowX ?? 0) - (runtimeState.nativePipeFirstArrowX ?? 0)),
    ).toBeGreaterThan(0.05)

    await page.getByTestId('preview-exit-button').click({ timeout: 10_000 })
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            Boolean(
              (window as Window & { __pascalDynamicPreviewRuntime?: unknown })
                .__pascalDynamicPreviewRuntime,
            ),
          ),
        { timeout: 10_000 },
      )
      .toBe(false)
  } finally {
    await setPreviewMode(false).catch(() => undefined)
  }
})
