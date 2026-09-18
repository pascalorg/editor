// Run from the repo root: bun run packages/viewer/scripts/pointer-events.bench.ts
import { _roots, createRoot, type Instance, events as stockEvents } from '@react-three/fiber'
import * as THREE from 'three'
import { createPascalPointerEvents } from '../src/lib/pointer-events'

const warmups = 50
const samples = 200
const rootCount = 1301
const meshCount = 4724

async function fixture(factory: typeof stockEvents) {
  const canvas = {} as HTMLCanvasElement
  const root = createRoot(canvas)
  await root.configure({
    gl: { render() {}, setSize() {}, setPixelRatio() {} },
    events: factory,
    frameloop: 'never',
    dpr: 1,
    size: { width: 100, height: 100, top: 0, left: 0 },
  })
  const store = _roots.get(canvas)!.store
  const state = store.getState()
  state.raycaster = new THREE.Raycaster()
  state.raycaster.firstHitOnly = false
  const groups: THREE.Group[] = []
  for (let i = 0; i < rootCount; i++) {
    const object = new THREE.Group()
    const instance: Instance<THREE.Group> = {
      root: store,
      type: 'group',
      parent: null,
      children: [],
      props: {},
      object,
      eventCount: 1,
      handlers: { onPointerMove() {} },
      isHidden: false,
    }
    Object.assign(object, { __r3f: instance })
    state.internal.interaction.push(object)
    if (i === 0) state.scene.add(object)
    else groups[Math.floor((i - 1) / 10)]!.add(object)
    groups.push(object)
  }
  const geometry = new THREE.BufferGeometry()
  const material = new THREE.MeshBasicMaterial()
  for (let i = 0; i < meshCount; i++) {
    const mesh = new THREE.Mesh(geometry, material)
    mesh.raycast = () => {}
    groups[131 + (i % (rootCount - 131))]!.add(mesh)
  }
  const event = { offsetX: 50, offsetY: 50, pointerId: 1 } as PointerEvent
  return {
    move: () => state.events.handlers!.onPointerMove(event),
    dispose() {
      _roots.delete(canvas)
      geometry.dispose()
      material.dispose()
    },
  }
}

const stock = await fixture(stockEvents)
const cached = await fixture(createPascalPointerEvents)
const timings = { stock: [] as number[], cached: [] as number[] }
for (let i = -warmups; i < samples; i++) {
  // Alternate order to keep warm-up and scheduling effects balanced.
  for (const name of i % 2 === 0
    ? (['stock', 'cached'] as const)
    : (['cached', 'stock'] as const)) {
    const target = name === 'stock' ? stock : cached
    const start = performance.now()
    target.move()
    const elapsed = performance.now() - start
    if (i >= 0) timings[name].push(elapsed)
  }
}
console.log({ rootCount, meshCount, warmups, samples })
for (const name of ['stock', 'cached'] as const) {
  const values = timings[name].sort((a, b) => a - b)
  console.log(`${name}: median ${((values[99]! + values[100]!) / 2).toFixed(3)} ms`)
}
stock.dispose()
cached.dispose()
