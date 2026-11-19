import { buildRock, RockNode } from '@pascal-app/core'
import {
  ACESFilmicToneMapping,
  BoxGeometry,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  LOD,
  Mesh,
  NoToneMapping,
  PerspectiveCamera,
  PlaneGeometry,
  RenderTarget,
  RGBAFormat,
  Scene,
  SRGBColorSpace,
  UnsignedByteType,
  Vector3,
} from 'three'
import { MeshStandardNodeMaterial, WebGPURenderer } from 'three/webgpu'
import { buildRockGeometry } from '../geometry'

// A standalone acceptance fixture: production geometry/material/LOD, no editor app, network
// assets, copied shader or test-mode production branch. The runner supplies one explicit backend.
const types = ['boulder', 'fjord', 'granite', 'volcanic', 'river', 'stacked', 'stepping'] as const
type Kind = (typeof types)[number]
type Suite = 'types' | 'garden' | 'looks' | 'reference' | 'benchmark' | 'shadow'
const width = 1280
const height = 800
const readWidth = 320
const readHeight = 200 // 1280 bytes/row: already a multiple of WebGPU's 256-byte alignment.
const params = new URLSearchParams(location.search)
const requestedBackend = params.get('backend') === 'webgl2' ? 'webgl2' : 'webgpu'
const renderer = new WebGPURenderer({ antialias: true, forceWebGL: requestedBackend === 'webgl2' })
renderer.setSize(width, height)
renderer.setPixelRatio(1)
renderer.outputColorSpace = SRGBColorSpace
renderer.toneMapping = NoToneMapping
renderer.shadowMap.enabled = true
renderer.info.autoReset = false
renderer.domElement.id = 'rock-canvas'
document.body.append(renderer.domElement)
const label = document.createElement('div')
label.style.cssText =
  'position:fixed;left:16px;top:16px;padding:8px 12px;background:#ffffffdf;color:#202a20;font:16px system-ui;border-radius:6px;pointer-events:none'
document.body.append(label)
const scene = new Scene()
scene.background = new Color('#bfd3dd')
const camera = new PerspectiveCamera(42, width / height, 0.05, 120)
const sun = new DirectionalLight('#fff3db', 2.4)
sun.position.set(-5, 9, 6)
sun.castShadow = true
sun.shadow.mapSize.set(1024, 1024)
sun.shadow.camera.left = -12
sun.shadow.camera.right = 12
sun.shadow.camera.top = 12
sun.shadow.camera.bottom = -12
sun.shadow.camera.near = 0.1
sun.shadow.camera.far = 35
sun.shadow.bias = -0.0002
scene.add(sun, new HemisphereLight('#dcecff', '#52613f', 1.8))
const ground = new Mesh(
  new PlaneGeometry(80, 80),
  new MeshStandardNodeMaterial({ color: '#607846', roughness: 1 }),
)
ground.rotation.x = -Math.PI / 2
ground.receiveShadow = true
scene.add(ground)
const content = new Group()
scene.add(content)
const target = new RenderTarget(readWidth, readHeight, {
  format: RGBAFormat,
  type: UnsignedByteType,
  colorSpace: SRGBColorSpace,
  samples: 0,
})
const errors: string[] = []
let serial = 0
let rockGroups: Group[] = []
let savedRocks: RockNode[] = []
let bench: unknown = null
let actualBackend = 'uninitialized'
let configurationKey = ''
let phase = 'initialization'
let shadowEvents: {
  phase: string
  frame: number
  rockIndex: number
  mesh: string
  triangles: number
}[] = []
let renderPhases: {
  phase: string
  frame: number
  shadowDraws: number
  renderInfo: typeof renderer.info.render
}[] = []
let probeWithoutRock: Uint8Array | null = null

function frameBoundary() {
  return new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  )
}
function renderReceipt(shadowStart: number) {
  renderPhases.push({
    phase,
    frame: renderer.info.frame,
    shadowDraws: shadowEvents.length - shadowStart,
    renderInfo: { ...renderer.info.render },
  })
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}
function pixelDifference(a: Uint8Array, b: Uint8Array) {
  assert(
    a.length === b.length && a.length === readWidth * readHeight * 4,
    'Incomplete RGBA8 readback',
  )
  let changedPixels = 0
  let maximumDelta = 0
  for (let offset = 0; offset < a.length; offset += 4) {
    let changed = false
    for (let channel = 0; channel < 3; channel++) {
      const difference = Math.abs(a[offset + channel]! - b[offset + channel]!)
      maximumDelta = Math.max(maximumDelta, difference)
      changed ||= difference !== 0
    }
    if (changed) changedPixels++
  }
  return { changedPixels, maximumDelta }
}
function base64(bytes: Uint8Array) {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 8192)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
  return btoa(binary)
}
function clearContent() {
  // All fixture rocks are gen 2: production documents these materials as tree-owned, uncached.
  content.traverse((object) => {
    if (object instanceof Mesh) {
      object.geometry.dispose()
      for (const material of Array.isArray(object.material) ? object.material : [object.material])
        material.dispose()
    }
  })
  content.clear()
  rockGroups = []
  savedRocks = []
}
function rock(
  kind: Kind,
  x: number,
  z: number,
  sizeX: number,
  sizeZ: number,
  rise: number,
  seed: number,
  extra: Partial<RockNode> = {},
) {
  const node = RockNode.parse({
    gen: 2,
    rockType: kind,
    seed,
    height: rise,
    weathering: 0.35,
    moss: 0.3,
    strata: false,
    polygon: [
      [x - sizeX / 2, z - sizeZ / 2],
      [x + sizeX / 2, z - sizeZ / 2],
      [x + sizeX / 2, z + sizeZ / 2],
      [x - sizeX / 2, z + sizeZ / 2],
    ],
    ...extra,
  })
  const group = buildRockGeometry(node)
  const rockIndex = rockGroups.length
  group.traverse((object) => {
    if (!(object instanceof Mesh)) return
    const previous = object.onBeforeShadow
    object.onBeforeShadow = (...args) => {
      shadowEvents.push({
        phase,
        frame: renderer.info.frame,
        rockIndex,
        mesh: object.name,
        triangles:
          (object.geometry.index?.count ?? object.geometry.getAttribute('position').count) / 3,
      })
      previous.apply(object, args)
    }
  })
  content.add(group)
  rockGroups.push(group)
  savedRocks.push(node)
  return group
}
function aim(distance: number, targetY = 0.55, bearing = 0.62) {
  const focus = new Vector3(0, targetY, 0)
  const direction = new Vector3(Math.sin(bearing), 0.43, Math.cos(bearing)).normalize()
  camera.position.copy(focus).addScaledVector(direction, distance)
  camera.lookAt(focus)
  camera.updateMatrixWorld(true)
}
function single(kind: Kind, extra: Partial<RockNode> = {}) {
  const size: Record<Kind, [number, number, number]> = {
    boulder: [2, 1.7, 1.3],
    fjord: [2, 0.7, 1.8],
    granite: [2, 1.7, 0.9],
    volcanic: [2, 1.8, 1.4],
    river: [2, 1.6, 0.8],
    stacked: [1.8, 1.6, 1.8],
    stepping: [1.7, 1.1, 0.16],
  }
  const [sx, sz, rise] = size[kind]
  rock(kind, 0, 0, sx, sz, rise, 17017, extra)
}
function garden() {
  rock('boulder', -2.2, 0, 2, 1.7, 1.25, 101, { moss: 0.55 })
  rock('granite', -3.4, 0.6, 1.35, 1.2, 0.7, 102, { moss: 0.35 })
  rock('fjord', -1.6, -1.1, 1.4, 0.7, 1.4, 103, { moss: 0.6 })
  for (let i = 0; i < 6; i++)
    rock('stepping', 0.3 + Math.sin(i * 0.6) * 0.3, -3 + i * 1.05, 0.85, 0.65, 0.12, 210 + i, {
      moss: 0.05,
      weathering: 0.65,
    })
  const bed = new Mesh(
    new BoxGeometry(2.5, 0.04, 4.5),
    new MeshStandardNodeMaterial({ color: '#514333', roughness: 1 }),
  )
  bed.position.set(3.1, 0, 0)
  bed.receiveShadow = true
  content.add(bed)
  for (let i = 0; i < 8; i++)
    rock(
      i % 2 ? 'river' : 'boulder',
      1.7,
      -2.4 + i * 0.68,
      0.58,
      0.63,
      0.28 + (i % 3) * 0.08,
      310 + i,
      { moss: 0.15, weathering: 0.75 },
    )
  for (let i = 0; i < 4; i++)
    rock('river', 2.3 + i * 0.64, 2.45, 0.64, 0.58, 0.25, 410 + i, { moss: 0.15, weathering: 0.8 })
}
function benchmarkBuild() {
  const warm = RockNode.parse({
    gen: 2,
    rockType: 'boulder',
    polygon: [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ],
    seed: 901,
  })
  const firstStart = performance.now()
  buildRock(warm)
  const firstBuildMs = performance.now() - firstStart
  const warmStart = performance.now()
  for (let i = 0; i < 3; i++) buildRock({ ...warm, seed: 902 + i })
  const warmupMs = performance.now() - warmStart
  const samples = []
  const start = performance.now()
  for (let i = 0; i < 30; i++) {
    const node = { ...warm, seed: 1000 + i, rockType: types[i % types.length]! }
    const started = performance.now()
    const built = buildRock(node)
    samples.push({
      seed: node.seed,
      rockType: node.rockType,
      cpuBuildMs: performance.now() - started,
      nearTriangles: (built.near?.index.length ?? 0) / 3,
      farTriangles: (built.far?.index.length ?? 0) / 3,
    })
  }
  const measuredBatchMs = performance.now() - start
  const objectStart = performance.now()
  for (let i = 0; i < 30; i++)
    rock(
      types[i % types.length]!,
      ((i % 6) - 2.5) * 1.65,
      (Math.floor(i / 6) - 2) * 1.65,
      1.25,
      1.1,
      0.9,
      1000 + i,
      { moss: 0.2 },
    )
  return {
    firstBuildMs,
    warmupMs,
    warmupBuilds: 3,
    samples,
    measuredBatchMs,
    productionObjectBuildMs: performance.now() - objectStart,
    measurement: 'CPU wall time; no GPU timestamps or acceptance latency threshold',
  }
}
async function pixels(renderScene = scene, label = 'readback') {
  // r187 ShadowNode caches once per camera/frame, not once per render call. A readback does
  // not guarantee that frame advanced. Wait BEFORE each state-dependent render, not after it.
  await frameBoundary()
  phase = label
  renderer.setRenderTarget(target)
  renderer.info.reset()
  const shadowStart = shadowEvents.length
  renderer.render(renderScene, camera)
  renderReceipt(shadowStart)
  const raw = await renderer.readRenderTargetPixelsAsync(target, 0, 0, readWidth, readHeight)
  assert(
    raw instanceof Uint8Array && raw.length === readWidth * readHeight * 4,
    'Expected tightly packed RGBA8 readback',
  )
  renderer.setRenderTarget(null)
  return raw
}
function selected() {
  const levels: { index: number; distance: number; thresholds: number[]; triangles: number }[] = []
  let visibleTriangles = 0
  for (const group of rockGroups) {
    group.traverse((object) => {
      if (object instanceof LOD) {
        let triangles = 0
        object.traverseVisible((child) => {
          if (child instanceof Mesh)
            triangles +=
              (child.geometry.index?.count ?? child.geometry.getAttribute('position').count) / 3
        })
        levels.push({
          index: object.getCurrentLevel(),
          distance: object.getWorldPosition(new Vector3()).distanceTo(camera.position),
          thresholds: object.levels.map((level) => level.distance),
          triangles,
        })
      }
    })
    group.traverseVisible((object) => {
      if (object instanceof Mesh)
        visibleTriangles +=
          (object.geometry.index?.count ?? object.geometry.getAttribute('position').count) / 3
    })
  }
  return { visibleTriangles, levels }
}
async function geometryWitnesses() {
  const meshes: { mesh: Mesh; rockIndex: number }[] = []
  rockGroups.forEach((group, rockIndex) => {
    group.traverse((object) => {
      if (object instanceof Mesh) meshes.push({ mesh: object, rockIndex })
    })
  })
  const digest = async (array: ArrayBufferView) => {
    const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength)
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('')
  }
  return Promise.all(
    meshes.map(async ({ mesh, rockIndex }) => ({
      rockIndex,
      name: mesh.name,
      triangles: (mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position').count) / 3,
      position: await digest(mesh.geometry.getAttribute('position').array),
      normal: await digest(mesh.geometry.getAttribute('normal').array),
      index: mesh.geometry.index ? await digest(mesh.geometry.index.array) : null,
      material: (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map(
        (material) => material.type,
      ),
    })),
  )
}
async function calibration() {
  const empty = new Scene()
  empty.background = new Color('#ff0000')
  const red = await pixels(empty)
  empty.background = new Color('#0000ff')
  const blue = await pixels(empty)
  for (let offset = 0; offset < red.length; offset += 4) {
    assert(
      red[offset] === 255 &&
        red[offset + 1] === 0 &&
        red[offset + 2] === 0 &&
        red[offset + 3] === 255,
      'Red RGBA8 calibration failed',
    )
    assert(
      blue[offset] === 0 &&
        blue[offset + 1] === 0 &&
        blue[offset + 2] === 255 &&
        blue[offset + 3] === 255,
      'Blue RGBA8 calibration/freshness failed',
    )
  }
  assert(pixelDifference(red, red).changedPixels === 0, 'Comparator rejects identity')
  assert(
    pixelDifference(red, blue).changedPixels === readWidth * readHeight,
    'Comparator failed a known full-frame divergence',
  )
  let rejectedIncomplete = false
  try {
    pixelDifference(red, new Uint8Array(0))
  } catch {
    rejectedIncomplete = true
  }
  assert(rejectedIncomplete, 'Comparator accepted incomplete data')
  return {
    status: 'PASS',
    pixels: readWidth * readHeight,
    channels: 'RGBA uint8',
    colorSpace: 'sRGB',
    padding: 'none in returned data; 1280 bytes per row',
    orientation: 'backend-native; within-backend comparisons only',
    synchronization:
      'two requestAnimationFrame callbacks BEFORE each state-dependent render; await readRenderTargetPixelsAsync; two more callbacks for screenshot presentation',
    red: Array.from(red.subarray(0, 4)),
    blue: Array.from(blue.subarray(0, 4)),
  }
}
function configure(id: string) {
  const [kind, distance] = id.split(':')
  const key = kind === 'garden' || kind === 'shadow' || types.includes(kind as Kind) ? kind : id
  if (key === configurationKey) {
    aim(
      distance === 'far' ? 15 : kind === 'garden' ? 10 : 4.8,
      kind === 'garden' ? 0.4 : 0.55,
      kind === 'garden' ? 0.3 : 0.62,
    )
    scene.updateMatrixWorld(true)
    label.textContent = `${id} · ${requestedBackend} · fixed seed · daylight`
    return
  }
  clearContent()
  configurationKey = key!
  bench = null
  if (kind === 'garden') {
    garden()
    aim(distance === 'far' ? 15 : 10, 0.4, 0.3)
  } else if (kind === 'shadow') {
    single('fjord')
    aim(4.8)
  } else if (kind === 'benchmark') {
    bench = benchmarkBuild()
    aim(15, 0.5, 0.3)
  } else if (kind === 'reference-fjord') {
    rock('fjord', 0, 0, 2.1, 0.65, 2.4, 17017, { moss: 0.6 })
    aim(6, 1, 0.42)
  } else if (kind === 'reference-granite') {
    rock('granite', 0, 0, 2.5, 1.8, 0.9, 17017, { moss: 0.1 })
    aim(5.5, 0.4, 0.62)
  } else if (kind === 'look') {
    const looks: Record<string, Partial<RockNode>> = {
      bare: { moss: 0, weathering: 0, strata: false, lichen: 0 },
      moss: { moss: 1, weathering: 0, strata: false, lichen: 0 },
      weathered: { moss: 0, weathering: 1, strata: false, lichen: 0 },
      strata: { moss: 0, weathering: 0, strata: true, lichen: 0 },
      lichen: { moss: 0, weathering: 0, strata: false, lichen: 1 },
    }
    single('boulder', looks[distance!])
    aim(4.8)
  } else {
    assert(types.includes(kind as Kind), `Unknown case: ${id}`)
    single(kind as Kind)
    aim(distance === 'far' ? 15 : 4.8)
  }
  scene.updateMatrixWorld(true)
  label.textContent = `${id} · ${requestedBackend} · fixed seed · daylight`
}
async function sampleSteadyFrameCpuSubmission() {
  const samples = []
  for (let sample = 0; sample < 10; sample++) {
    await frameBoundary()
    phase = `benchmark-steady-${sample + 1}`
    renderer.info.reset()
    const shadowStart = shadowEvents.length
    const started = performance.now()
    renderer.render(scene, camera)
    const cpuSubmitMs = performance.now() - started
    renderReceipt(shadowStart)
    samples.push({
      frame: renderer.info.frame,
      cpuSubmitMs,
      renderInfo: { ...renderer.info.render },
    })
  }
  await frameBoundary()
  const sorted = samples.map((sample) => sample.cpuSubmitMs).sort((a, b) => a - b)
  return {
    sampleCount: samples.length,
    samples,
    medianMs: (sorted[4]! + sorted[5]!) / 2,
    maxMs: sorted[9]!,
    measurement:
      'CPU synchronous renderer.render wall time after initial canvas submission; ten double-rAF-separated frames, unchanged scene/camera. Excludes waiting/readback; not GPU completion time or FPS. No latency pass threshold.',
  }
}

const caseIds: Record<Suite, string[]> = {
  types: types.flatMap((type) => [`${type}:close`, `${type}:far`]),
  garden: ['garden:close', 'garden:far'],
  looks: ['look:bare', 'look:moss', 'look:weathered', 'look:strata', 'look:lichen'],
  reference: ['reference-fjord', 'reference-granite'],
  benchmark: ['benchmark:30'],
  shadow: ['shadow:stale', 'shadow:fresh'],
}
let calibrationResult: unknown
const ready = (async () => {
  await renderer.init()
  const backend = renderer.backend as typeof renderer.backend & {
    isWebGPUBackend?: boolean
    isWebGLBackend?: boolean
    device?: {
      addEventListener: (
        name: string,
        listener: (event: { error: { message: string } }) => void,
      ) => void
    }
  }
  actualBackend = backend.isWebGPUBackend ? 'webgpu' : backend.isWebGLBackend ? 'webgl2' : 'unknown'
  assert(
    actualBackend === requestedBackend,
    `BLOCKED: requested ${requestedBackend}, initialized ${actualBackend}; fallback is NOT a WebGPU pass`,
  )
  backend.device?.addEventListener('uncapturederror', (event) => {
    errors.push(event.error.message)
  })
  calibrationResult = await calibration()
  renderer.toneMapping = ACESFilmicToneMapping
  renderer.toneMappingExposure = 1
})()

Object.assign(window, {
  rockAcceptance: {
    ready,
    cases: (suite: Suite) => caseIds[suite],
    async capture(id: string) {
      await ready
      configure(id)
      shadowEvents = []
      renderPhases = []
      const compileStart = performance.now()
      await renderer.compileAsync(scene, camera)
      const compileMs = performance.now() - compileStart
      const withRock = await pixels(scene, 'actual')
      const selection = selected()
      assert(selection.visibleTriangles > 0, 'Production rocks contributed no triangles')
      let withoutRock: Uint8Array
      if (id === 'shadow:fresh') {
        assert(probeWithoutRock, 'The paired shadow probe must capture stale before fresh')
        withoutRock = probeWithoutRock
      } else {
        for (const group of rockGroups) group.visible = false
        withoutRock = await pixels(scene, 'no-rock')
        if (id === 'shadow:stale') probeWithoutRock = withoutRock
      }
      const witness = pixelDifference(withRock, withoutRock)
      assert(
        witness.changedPixels > 0,
        'Real production rock visibility did not change any RGB pixel',
      )
      for (const group of rockGroups) group.visible = true
      // Only the diagnostic stale half deliberately retains the old broken ordering. Its paired
      // fresh half keeps geometry/light/camera unchanged and never hides the rock again.
      if (id !== 'shadow:stale') await frameBoundary()
      phase = id === 'shadow:stale' ? 'restored-without-frame-boundary' : 'restored-fresh-frame'
      renderer.info.reset()
      const shadowStart = shadowEvents.length
      const submitStart = performance.now()
      renderer.render(scene, camera)
      const cpuSubmitMs = performance.now() - submitStart
      renderReceipt(shadowStart)
      const renderInfo = { ...renderer.info.render }
      await frameBoundary()
      const steadyFrameCpuSubmission =
        id === 'benchmark:30' ? await sampleSteadyFrameCpuSubmission() : null
      assert(errors.length === 0, `GPU validation errors: ${errors.join('; ')}`)
      if (id.endsWith(':far') && types.includes(id.split(':')[0] as Kind)) {
        assert(
          selection.levels.length === 1 && selection.levels[0]!.index === 1,
          '15 m camera did not select the far production LOD',
        )
        assert(selection.visibleTriangles <= 600, 'Rendered far LOD exceeds 600 triangles')
      }
      if (id.endsWith(':close') && types.includes(id.split(':')[0] as Kind)) {
        assert(
          selection.levels.length === 1 && selection.levels[0]!.index === 0,
          'Close camera did not select the near production LOD',
        )
        assert(selection.visibleTriangles <= 4096, 'Rendered near LOD exceeds 4096 triangles')
      }
      return {
        id,
        serial: ++serial,
        requestedBackend,
        actualBackend,
        compileMs,
        cpuSubmitMs,
        steadyFrameCpuSubmission,
        renderInfo,
        renderPhases,
        shadowEvents,
        shadowProbe: id.startsWith('shadow:')
          ? {
              diagnosticOnly: true,
              ordering: id.endsWith(':stale')
                ? 'old immediate restore; cache reuse may depend on observed frame IDs'
                : 'fresh visible scene; no intervening hide',
              note: 'Main compares paired PNGs and shadow draw/frame receipts; no new visual acceptance threshold',
            }
          : null,
        selection,
        witness,
        geometry: await geometryWitnesses(),
        calibration: calibrationResult,
        benchmark: bench,
        savedRocks,
        camera: {
          position: camera.position.toArray(),
          targetDistance: id.endsWith(':far') ? 15 : null,
          fov: camera.fov,
          near: camera.near,
          far: camera.far,
        },
        profile: {
          width,
          height,
          pixelRatio: 1,
          readWidth,
          readHeight,
          time: 0,
          sun: [-5, 9, 6],
          sunIntensity: 2.4,
          hemisphereIntensity: 1.8,
          toneMapping: 'ACES filmic',
          exposure: 1,
          output: 'sRGB',
          shadowMap: 1024,
          gpuIdentity: 'not observed',
        },
        actualRGBA: base64(withRock),
        noRockRGBA: base64(withoutRock),
        gpuErrors: [...errors],
      }
    },
  },
})
