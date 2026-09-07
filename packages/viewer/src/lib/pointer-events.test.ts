import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import {
  _roots,
  act,
  createPortal,
  createRoot,
  type DomEvent,
  type EventHandlers,
  type Events,
  extend,
  type Instance,
  type Intersection,
  type RootState,
  events as stockEvents,
  type ThreeEvent,
} from '@react-three/fiber'
import { createElement } from 'react'
import * as THREE from 'three'
import { createWithEqualityFn } from 'zustand/traditional'
import { BATCHED_LAYER } from './layers'
import { createPascalPointerEvents } from './pointer-events'

extend({ Group: THREE.Group })

const require = createRequire(import.meta.url)
const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
})

type Factory = typeof stockEvents
type PointerData = ThreeEvent<PointerEvent>
type Action = (name: keyof EventHandlers, event: PointerData) => void
const handlerNames = [
  'onPointerMove',
  'onPointerOver',
  'onPointerEnter',
  'onPointerOut',
  'onPointerLeave',
  'onPointerDown',
  'onPointerUp',
  'onClick',
  'onDoubleClick',
  'onContextMenu',
  'onWheel',
] as const

function hitData(hit: THREE.Intersection | Intersection) {
  const { object, ...metadata } = hit
  const eventObject = 'eventObject' in hit ? hit.eventObject : undefined
  return {
    ...metadata,
    object: object.uuid,
    ...('eventObject' in hit ? { eventObject: eventObject?.uuid } : {}),
  }
}

function eventData(event: ThreeEvent<DomEvent>) {
  const {
    object,
    eventObject,
    intersections,
    camera,
    target,
    currentTarget,
    nativeEvent,
    ...data
  } = event
  return {
    ...data,
    object: object.uuid,
    eventObject: eventObject.uuid,
    intersections: intersections.map(hitData),
    camera: camera.uuid,
    nativeEvent: {
      type: nativeEvent.type,
      offsetX: nativeEvent.offsetX,
      offsetY: nativeEvent.offsetY,
    },
    captured: 'pointerId' in event ? target.hasPointerCapture(event.pointerId) : false,
  }
}

// JSON freezes mutable vector/ray payloads at the point they are delivered, omitting only functions.
function freeze(value: unknown) {
  return JSON.parse(JSON.stringify(value))
}

async function fixture(factory: Factory) {
  const trace: unknown[] = []
  const calls = new Map<string, number>()
  const objects = new Map<string, THREE.Object3D>()
  const nativeCapture = new Set<number>()
  const listeners = new Map<string, EventListener>()
  const target = {
    addEventListener(name: string, handler: EventListener, options: unknown) {
      listeners.set(name, handler)
      trace.push(['connect', name, options])
    },
    removeEventListener(name: string, handler: EventListener) {
      expect(listeners.get(name)).toBe(handler)
      listeners.delete(name)
      trace.push(['disconnect', name])
    },
    setPointerCapture(id: number) {
      nativeCapture.add(id)
      trace.push(['capture', id])
    },
    releasePointerCapture(id: number) {
      nativeCapture.delete(id)
      trace.push(['release', id])
    },
  }
  const canvas = target as unknown as HTMLCanvasElement
  const root = createRoot(canvas)
  cleanups.push(() => _roots.delete(canvas))
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100)
  camera.uuid = 'camera'
  camera.position.z = 10
  camera.updateMatrixWorld()
  await root.configure({
    gl: { render() {}, setSize() {}, setPixelRatio() {} },
    camera,
    events: factory,
    frameloop: 'never',
    dpr: 1,
    size: { width: 100, height: 100, top: 0, left: 0 },
  })
  const store = _roots.get(canvas)!.store
  const state = store.getState()
  state.raycaster = new THREE.Raycaster()
  state.raycaster.firstHitOnly = false
  const compute = state.events.compute!
  state.events.compute = (event, layer, previous) => {
    trace.push(['compute', layer.camera.uuid, previous?.camera.uuid])
    compute(event, layer, previous)
  }
  state.events.filter = (hits) => {
    trace.push(['filter', freeze(hits.map(hitData))])
    return hits
  }
  state.onPointerMissed = (event) => trace.push(['canvasMissed', event.type])

  function handlers(
    object: THREE.Object3D,
    names: readonly (keyof EventHandlers)[] = handlerNames,
    action?: Action,
  ): EventHandlers {
    return Object.fromEntries(
      names.map((name) => [
        name,
        (event: PointerData) => {
          if (name === 'onPointerMissed') {
            trace.push([object.uuid, name, event.type])
            return
          }
          expect(objects.get(event.object.uuid)).toBe(event.object)
          expect(event.eventObject).toBe(object)
          for (const hit of event.intersections) {
            expect(objects.get(hit.object.uuid)).toBe(hit.object)
            expect(objects.get(hit.eventObject.uuid)).toBe(hit.eventObject)
          }
          trace.push([object.uuid, name, freeze(eventData(event))])
          action?.(name, event)
          trace.push([object.uuid, name, 'stopped', event.stopped])
        },
      ]),
    )
  }

  function register<T extends THREE.Object3D>(
    object: T,
    names: readonly (keyof EventHandlers)[] = handlerNames,
    action?: Action,
    layer = store,
  ) {
    const local: Instance<T> = {
      root: layer,
      type: 'primitive',
      parent: null,
      children: [],
      props: { object },
      object,
      eventCount: names.length,
      handlers: handlers(object, names, action),
      isHidden: false,
    }
    Object.assign(object, { __r3f: local })
    if (names.length) store.getState().internal.interaction.push(object)
    return object
  }

  function group(name: string) {
    const object = new THREE.Group()
    object.uuid = name
    objects.set(name, object)
    state.scene.add(object)
    return register(object)
  }

  function mesh(
    name: string,
    distances = [1],
    names: readonly (keyof EventHandlers)[] = handlerNames,
    action?: Action,
  ) {
    const object = new THREE.Mesh()
    object.uuid = name
    objects.set(name, object)
    state.scene.add(object)
    object.raycast = (raycaster, hits) => {
      calls.set(name, (calls.get(name) ?? 0) + 1)
      if (raycaster.ray.direction.x > 0.5) return
      for (const [index, distance] of distances.entries()) {
        hits.push({
          object,
          distance,
          point: new THREE.Vector3(index, 2, 3),
          faceIndex: index + 10,
          face: { a: index, b: 2, c: 3, normal: new THREE.Vector3(0, 1, 0), materialIndex: index },
          uv: new THREE.Vector2(index / 4, 0.7),
          uv1: new THREE.Vector2(0.2, 0.3),
          normal: new THREE.Vector3(0, 0, 1),
        })
      }
    }
    return register(object, names, action)
  }

  function snapshot(label: string) {
    trace.push([
      label,
      freeze({
        hovered: [...store.getState().internal.hovered].map(([id, event]) => [
          id,
          eventData(event),
        ]),
        captures: [...store.getState().internal.capturedMap].map(([id, captures]) => [
          id,
          [...captures].map(([object, capture]) => {
            expect(capture.target).toBe(target)
            return [object.uuid, hitData(capture.intersection)]
          }),
        ]),
        initialHits: store.getState().internal.initialHits.map((object) => object.uuid),
        initialClick: store.getState().internal.initialClick,
        nativeCapture: [...nativeCapture],
      }),
    ])
  }

  function send(name: keyof Events, x = 50, y = 50, pointerId = 1) {
    const event = {
      type: name.slice(2).toLowerCase(),
      offsetX: x,
      offsetY: y,
      pointerId,
      buttons: name === 'onPointerDown' ? 1 : 0,
      deltaY: 12,
      target,
    } as unknown as PointerEvent
    state.events.handlers![name](event)
    snapshot(name)
  }
  return {
    root,
    store,
    get state() {
      return store.getState()
    },
    camera,
    target,
    trace,
    calls,
    objects,
    handlers,
    register,
    group,
    mesh,
    send,
    snapshot,
    listeners,
  }
}
type Fixture = Awaited<ReturnType<typeof fixture>>

async function differential(run: (fixture: Fixture) => void | Promise<void>) {
  const stock = await fixture(stockEvents)
  await run(stock)
  const cached = await fixture(createPascalPointerEvents)
  await run(cached)
  expect(cached.trace).toEqual(stock.trace)
  return { stock, cached }
}

function nested(f: Fixture) {
  const parent = f.group('parent')
  const a = f.mesh('a', [2, 1, 1])
  const b = f.mesh('b', [1])
  parent.add(a, b)
  return { parent, a, b }
}

describe('R3F 9.6.1 pointer-event differential', () => {
  test('pins the vendored closure to the installed R3F version', () => {
    const pkg = JSON.parse(readFileSync(require.resolve('@react-three/fiber/package.json'), 'utf8'))
    expect(pkg.version, 'R3F version drift: re-vendor pointer-events.ts').toBe('9.6.1')
  })

  test('nested handlers preserve the complete ordered hit metadata and callback/hover order', async () => {
    const { cached } = await differential((f) => {
      nested(f)
      f.send('onPointerMove')
      f.send('onPointerMove')
      f.send('onPointerLeave')
    })
    expect(cached.calls.get('a')).toBe(2)
    expect(cached.calls.get('b')).toBe(2)
  })

  test('standard mesh and instanced geometry keep plugin handlers on the cached path', async () => {
    const { cached } = await differential((f) => {
      const parent = f.group('parent')
      const geometry = new THREE.BoxGeometry(2, 2, 2)
      const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
      cleanups.push(() => {
        geometry.dispose()
        material.dispose()
      })
      const mesh = new THREE.Mesh(geometry, material)
      mesh.uuid = 'mesh'
      const instances = new THREE.InstancedMesh(geometry, material, 2)
      instances.uuid = 'instances'
      instances.setMatrixAt(0, new THREE.Matrix4())
      instances.setMatrixAt(1, new THREE.Matrix4().makeTranslation(0, 0, -3))
      for (const object of [mesh, instances]) {
        f.objects.set(object.uuid, object)
        f.register(object)
        const raycast = object.raycast
        object.raycast = (raycaster, hits) => {
          f.calls.set(object.uuid, (f.calls.get(object.uuid) ?? 0) + 1)
          raycast.call(object, raycaster, hits)
        }
        parent.add(object)
      }
      f.state.scene.updateMatrixWorld(true)
      f.send('onPointerMove', 51, 52)
      mesh.position.x = 20
      f.state.scene.updateMatrixWorld(true)
      f.send('onPointerMove', 51, 52)
    })
    expect(cached.calls.get('mesh')).toBe(2)
    expect(cached.calls.get('instances')).toBe(2)
    const filters = cached.trace.filter(
      (entry) => Array.isArray(entry) && entry[0] === 'filter',
    ) as [string, { object: string; instanceId?: number }[]][]
    expect(filters[0]![1].map((hit) => [hit.object, hit.instanceId])).toEqual([
      ['mesh', undefined],
      ['instances', 0],
      ['instances', 1],
    ])
    expect(filters[1]![1].map((hit) => hit.object)).toEqual(['instances', 'instances'])
  })

  test('unmanaged mesh children bubble using the nearest managed ancestor state', async () => {
    await differential((f) => {
      const parent = f.group('parent')
      const child = f.mesh('unmanaged', [1], [])
      delete (child as Partial<Instance<THREE.Mesh>['object']>).__r3f
      parent.add(child)
      f.send('onPointerMove')
      f.send('onPointerDown')
      f.send('onClick')
    })
  })

  test('click-only ancestors do not hide moving descendants', async () => {
    const { cached } = await differential((f) => {
      const { parent } = nested(f)
      const instance = (parent as Instance<THREE.Group>['object']).__r3f!
      instance.handlers = f.handlers(parent, ['onClick'])
      instance.eventCount = 1
      f.send('onPointerMove')
      f.send('onPointerDown')
      f.send('onClick')
    })
    expect(
      cached.trace.some(
        (entry) => Array.isArray(entry) && entry[0] === 'parent' && entry[1] === 'onClick',
      ),
    ).toBe(true)
  })

  test('equal distances retain childB before childA for registration [childB, parent]', async () => {
    const { cached } = await differential((f) => {
      const parent = f.group('parent')
      const a = f.mesh('a')
      const b = f.mesh('b')
      parent.add(a, b)
      f.state.internal.interaction = [b, parent]
      f.send('onPointerMove')
    })
    const filtered = cached.trace.find(
      (entry) => Array.isArray(entry) && entry[0] === 'filter',
    ) as [string, { object: string }[]]
    expect(filtered[1].map((hit) => hit.object)).toEqual(['b', 'a'])
  })

  test('preserves per-root sorting before global sorting when hit objects belong to different layers', async () => {
    await differential((f) => {
      const { parent, a, b } = nested(f)
      const layer = createWithEqualityFn<RootState>(() => ({
        ...f.state,
        events: { ...f.state.events, priority: 3 },
      }))
      ;(a as Instance<THREE.Mesh>['object']).__r3f!.root = layer
      f.state.internal.interaction = [b, parent]
      f.send('onPointerMove')
    })
  })

  test('stopPropagation flushes existing hover and replays a previously stopped hover', async () => {
    const { cached } = await differential((f) => {
      const a = f.mesh('a')
      f.mesh('b', [2])
      f.send('onPointerMove')
      ;(a as Instance<THREE.Mesh>['object']).__r3f!.handlers = f.handlers(
        a,
        handlerNames,
        (name, event) => {
          if (name === 'onPointerMove') event.stopPropagation()
        },
      )
      f.send('onPointerMove')
      f.send('onPointerLeave')
      ;(a as Instance<THREE.Mesh>['object']).__r3f!.handlers = f.handlers(
        a,
        handlerNames,
        (name, event) => {
          if (name === 'onPointerOver') event.stopPropagation()
        },
      )
      f.send('onPointerMove')
      f.send('onPointerMove')
    })
    expect([...cached.state.internal.hovered.values()].map((hit) => hit.eventObject.uuid)).toEqual([
      'a',
    ])
  })

  test('capture delivers away from geometry, prevents other targets stopping propagation, and releases', async () => {
    const { cached } = await differential((f) => {
      f.mesh('a', [1], handlerNames, (name, event) => {
        if (name === 'onPointerMove') event.stopPropagation()
      })
      f.mesh('b', [2], handlerNames, (name, event) => {
        if (name === 'onPointerDown') event.target.setPointerCapture(event.pointerId)
        if (name === 'onPointerUp') {
          expect(event.currentTarget.hasPointerCapture(event.pointerId)).toBe(true)
          event.currentTarget.releasePointerCapture(event.pointerId)
        }
      })
      f.send('onPointerDown')
      f.send('onPointerMove')
      f.send('onPointerMove', 200)
      f.send('onPointerUp', 200)
      f.send('onPointerMove', 200)
    })
    expect(cached.state.internal.capturedMap.size).toBe(0)
  })

  test('multiple capture targets release the DOM capture only after the last release', async () => {
    const { cached } = await differential((f) => {
      for (const name of ['a', 'b'])
        f.mesh(name, [1], handlerNames, (handler, event) => {
          if (handler === 'onPointerDown') event.target.setPointerCapture(event.pointerId)
          if (handler === 'onPointerUp') event.target.releasePointerCapture(event.pointerId)
        })
      f.send('onPointerDown')
      f.send('onPointerUp', 200)
    })
    expect(
      cached.trace.filter((entry) => Array.isArray(entry) && entry[0] === 'release'),
    ).toHaveLength(1)
  })

  for (const releaseOnUp of [false, true])
    test(`lost capture waits for the next frame (release on up: ${releaseOnUp})`, async () => {
      const original = globalThis.requestAnimationFrame
      cleanups.push(() => {
        globalThis.requestAnimationFrame = original
      })
      await differential((f) => {
        const frames: FrameRequestCallback[] = []
        globalThis.requestAnimationFrame = (callback) => frames.push(callback)
        f.mesh('a', [1], handlerNames, (name, event) => {
          if (name === 'onPointerDown') event.target.setPointerCapture(event.pointerId)
          if (releaseOnUp && name === 'onPointerUp')
            event.target.releasePointerCapture(event.pointerId)
        })
        f.send('onPointerMove')
        f.send('onPointerDown')
        f.send('onLostPointerCapture', 200)
        expect(f.state.internal.capturedMap.size).toBe(1)
        f.send('onPointerUp', 200)
        for (const callback of frames) callback(0)
        f.snapshot('frame')
        expect(f.state.internal.capturedMap.size).toBe(0)
      })
    })

  test('cancel clears hover while preserving upstream capture semantics', async () => {
    await differential((f) => {
      f.mesh('a', [1], handlerNames, (name, event) => {
        if (name === 'onPointerDown') event.target.setPointerCapture(event.pointerId)
      })
      f.send('onPointerMove')
      f.send('onPointerDown')
      f.send('onPointerCancel')
      expect(f.state.internal.hovered.size).toBe(0)
      expect(f.state.internal.capturedMap.size).toBe(1)
      f.send('onPointerMove', 200)
    })
  })

  test('pointer missed, initial click targets, rounded click threshold, context menu and double click', async () => {
    await differential((f) => {
      f.mesh('a', [1], [...handlerNames, 'onPointerMissed'])
      f.mesh('miss', [], ['onPointerMissed'])
      f.send('onPointerDown')
      f.send('onClick', 70)
      f.send('onContextMenu')
      f.send('onDoubleClick')
      f.send('onPointerDown', 200)
      const before = f.trace.length
      f.send('onClick', 203)
      expect(
        f.trace.slice(before).some((entry) => Array.isArray(entry) && entry[0] === 'canvasMissed'),
      ).toBe(false)
      f.send('onClick', 202)
      f.send('onDoubleClick', 201, 51)
      f.send('onContextMenu', 200)
      f.send('onClick', 50)
    })
  })

  test('wheel uses click-only roots and preserves wheel metadata', async () => {
    await differential((f) => {
      const parent = f.group('parent')
      const child = f.mesh('child', [3, 1], ['onWheel'])
      parent.add(child)
      f.send('onWheel')
    })
  })

  test('disabled layers and compute without a camera skip queries', async () => {
    const { cached } = await differential((f) => {
      nested(f)
      f.state.events.enabled = false
      f.send('onPointerMove')
      f.state.events.enabled = true
      f.state.events.compute = () => {}
      f.send('onPointerMove')
      expect(f.calls.size).toBe(0)
    })
    expect(cached.calls.size).toBe(0)
  })

  test('custom recursion barriers leave explicitly registered descendants queryable', async () => {
    const { cached } = await differential((f) => {
      const parent = f.group('parent')
      parent.raycast = () => false
      const hidden = f.mesh('blocked', [1], [])
      const explicit = f.mesh('explicit')
      parent.add(hidden, explicit)
      f.send('onPointerMove')
      expect(f.calls.has('blocked')).toBe(false)
    })
    expect(cached.calls.get('explicit')).toBe(1)
  })

  test('layer mismatch does not apply a recursion barrier; invisible batched sources remain pickable', async () => {
    const { cached } = await differential((f) => {
      const parent = f.group('parent')
      parent.raycast = () => false
      parent.layers.set(BATCHED_LAYER)
      const child = f.mesh('child')
      parent.add(child)
      f.send('onPointerMove')
      child.visible = false
      child.layers.set(BATCHED_LAYER)
      parent.layers.set(0)
      f.state.raycaster.layers.enable(BATCHED_LAYER)
      f.send('onPointerMove')
    })
    expect(cached.calls.get('child')).toBe(2)
  })

  test('instance/index dedupe and tied face emission order retain all metadata', async () => {
    await differential((f) => {
      const { a } = nested(f)
      a.raycast = (raycaster, hits) => {
        for (const instanceId of [2, 0, 2])
          for (const index of [3, 1]) {
            hits.push({
              object: a,
              distance: 1,
              point: raycaster.ray.at(1, new THREE.Vector3()),
              instanceId,
              index,
              faceIndex: hits.length,
              uv: new THREE.Vector2(0.25, 0.75),
            })
          }
      }
      f.send('onPointerMove')
    })
  })

  for (const mode of ['subclass', 'override', 'opaque params', 'extra state'] as const)
    test(`stock compatibility fallback: ${mode}`, async () => {
      const { stock, cached } = await differential((f) => {
        nested(f)
        if (mode === 'subclass') {
          class CustomRaycaster extends THREE.Raycaster {
            override intersectObject<T extends THREE.Object3D>(
              object: T,
              recursive = true,
              hits: THREE.Intersection<T>[] = [],
            ) {
              f.trace.push(['customRaycaster', object.uuid])
              return super.intersectObject(object, recursive, hits).reverse()
            }
          }
          f.state.raycaster = new CustomRaycaster()
        } else if (mode === 'override') {
          f.state.raycaster.intersectObject = function (object, recursive, hits) {
            f.trace.push(['customRaycaster', object.uuid])
            return THREE.Raycaster.prototype.intersectObject.call(this, object, recursive, hits)
          }
        } else if (mode === 'opaque params') {
          f.state.raycaster.params.Mesh = { plugin: new Map() }
        } else Object.assign(f.state.raycaster, { pluginQuery: { revision: 1 } })
        f.send('onPointerMove')
      })
      expect(cached.calls).toEqual(stock.calls)
      expect(cached.calls.get('a')).toBe(2)
    })

  test('per-layer compute can mutate an earlier query, with shared internal state and distinct rays', async () => {
    await differential((f) => {
      const { parent, a, b } = nested(f)
      const layerCamera = new THREE.PerspectiveCamera()
      layerCamera.uuid = 'portal-camera'
      layerCamera.updateMatrixWorld()
      const layer = createWithEqualityFn<RootState>(() => ({
        ...f.state,
        camera: layerCamera,
        previousRoot: f.store,
        raycaster: new THREE.Raycaster(),
        pointer: new THREE.Vector2(),
        events: {
          ...f.state.events,
          priority: 2,
          compute(event, state, previous) {
            expect(previous).toBe(f.state)
            f.trace.push(['portalCompute'])
            state.raycaster.setFromCamera(state.pointer, state.camera)
            f.state.raycaster.ray.direction.x = 1
          },
        },
      }))
      ;(b as Instance<THREE.Mesh>['object']).__r3f!.root = layer
      f.state.internal.interaction = [a, b, parent]
      f.send('onPointerMove')
    })
  })

  test('changing query parameters between roots falls back without stale subtree reuse', async () => {
    await differential((f) => {
      const { parent, a, b } = nested(f)
      const raycast = b.raycast
      b.raycast = (raycaster, hits) => {
        raycast.call(b, raycaster, hits)
        raycaster.params.Line.threshold += 1
      }
      f.state.internal.interaction = [a, b, parent]
      f.send('onPointerMove')
    })
  })

  test('an already-computed layer can invalidate another layer after cached replay', async () => {
    await differential((f) => {
      const { parent, a, b } = nested(f)
      const portalRoot = f.group('portal-root')
      const portalMesh = f.mesh('portal-mesh')
      const layer = createWithEqualityFn<RootState>(() => ({
        ...f.state,
        previousRoot: f.store,
        raycaster: new THREE.Raycaster(),
        events: {
          ...f.state.events,
          compute(_event, state) {
            state.raycaster.setFromCamera(state.pointer, state.camera)
          },
        },
      }))
      for (const object of [portalRoot, portalMesh])
        (object as Instance<THREE.Object3D>['object']).__r3f!.root = layer
      const raycast = portalMesh.raycast
      portalMesh.raycast = (raycaster, hits) => {
        raycast.call(portalMesh, raycaster, hits)
        f.state.raycaster.ray.direction.x = 1
      }
      f.state.internal.interaction = [portalRoot, parent, a, portalMesh, b]
      f.send('onPointerMove')
    })
  })

  test('nested pointer collection keeps the outer scratch storage intact', async () => {
    await differential((f) => {
      const { a } = nested(f)
      const raycast = a.raycast
      let nestedEvent = false
      a.raycast = (raycaster, hits) => {
        raycast.call(a, raycaster, hits)
        if (!nestedEvent) {
          nestedEvent = true
          f.send('onPointerMove')
        }
      }
      f.send('onPointerMove')
      f.send('onPointerMove')
    })
  })

  test('a throwing raycast releases scratch storage before the next pointer event', async () => {
    await differential((f) => {
      const { a } = nested(f)
      const raycast = a.raycast
      a.raycast = (raycaster, hits) => {
        raycast.call(a, raycaster, hits)
        throw new Error('raycast failed')
      }
      expect(() => f.send('onPointerMove')).toThrow('raycast failed')
      a.raycast = raycast
      f.send('onPointerMove')
    })
  })

  test('filters, callbacks and update replay can issue fresh independent queries', async () => {
    const { cached } = await differential((f) => {
      const { a } = nested(f)
      const original = f.state.events.filter!
      f.state.events.filter = (hits, state) => {
        original(hits, state)
        const independent = state.raycaster.intersectObject(a, true)
        f.trace.push(['independent', freeze(independent.map(hitData))])
        return hits.reverse()
      }
      ;(a as Instance<THREE.Mesh>['object']).__r3f!.handlers = f.handlers(
        a,
        handlerNames,
        (name) => {
          if (name === 'onPointerMove') f.state.raycaster.intersectObject(a, true)
        },
      )
      f.send('onPointerMove')
      f.state.events.update!()
      f.snapshot('update')
    })
    expect(cached.calls.get('a')).toBe(6)
  })

  test('web connect/disconnect preserves listener names, options, handler identity and update', async () => {
    await differential((f) => {
      f.mesh('a')
      f.state.events.connect!(f.target as unknown as HTMLElement)
      expect(f.listeners.size).toBe(10)
      f.listeners.get('pointermove')!({
        type: 'pointermove',
        offsetX: 50,
        offsetY: 50,
        pointerId: 1,
        target: f.target,
      } as unknown as PointerEvent)
      f.state.events.update!()
      f.snapshot('update')
      f.state.events.disconnect!()
      expect(f.listeners.size).toBe(0)
    })
  })

  test('real R3F primitive unmount removes hover, initial hits and pointer capture', async () => {
    const original = globalThis.IS_REACT_ACT_ENVIRONMENT
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    cleanups.push(() => {
      globalThis.IS_REACT_ACT_ENVIRONMENT = original
    })
    await differential(async (f) => {
      const object = f.mesh('mounted')
      f.state.internal.interaction = []
      delete (object as Partial<Instance<THREE.Mesh>['object']>).__r3f
      await act(async () => {
        f.root.render(
          createElement('primitive', {
            object,
            ...f.handlers(object, handlerNames, (name, event) => {
              if (name === 'onPointerDown') event.target.setPointerCapture(event.pointerId)
            }),
          }),
        )
      })
      f.send('onPointerMove')
      f.send('onPointerDown')
      expect(f.state.internal.capturedMap.size).toBe(1)
      await act(async () => {
        f.root.render(null)
      })
      f.snapshot('unmount')
      expect(f.state.internal.interaction).toEqual([])
      expect(f.state.internal.hovered.size).toBe(0)
      expect(f.state.internal.capturedMap.size).toBe(0)
      expect(f.state.internal.initialHits).toEqual([])
      f.send('onPointerMove')
    })
  })

  test('real portals preserve layer priority, independent compute, disabled layers and bubbling', async () => {
    const original = globalThis.IS_REACT_ACT_ENVIRONMENT
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    cleanups.push(() => {
      globalThis.IS_REACT_ACT_ENVIRONMENT = original
    })
    await differential(async (f) => {
      const object = f.mesh('portal')
      const ordinary = f.mesh('ordinary')
      for (const mesh of [object, ordinary])
        delete (mesh as Partial<Instance<THREE.Mesh>['object']>).__r3f
      f.state.internal.interaction = []
      const portalScene = new THREE.Scene()
      const portalCamera = f.camera.clone()
      portalCamera.uuid = 'portal-camera'
      const render = (enabled: boolean) =>
        createElement(
          'group',
          null,
          createElement('primitive', { object: ordinary, ...f.handlers(ordinary) }),
          createPortal(createElement('primitive', { object, ...f.handlers(object) }), portalScene, {
            camera: portalCamera,
            events: {
              enabled,
              priority: 2,
              compute(event, state, previous) {
                f.trace.push(['portalCompute', previous?.camera.uuid])
                state.raycaster.setFromCamera(state.pointer, state.camera)
              },
            },
          }),
        )
      await act(async () => {
        f.root.render(render(true))
      })
      f.send('onPointerMove')
      await act(async () => {
        f.root.render(render(false))
      })
      f.send('onPointerMove')
      await act(async () => {
        f.root.render(null)
      })
    })
  })

  test('one pointermove tests each mesh once in a four-level nested fixture', async () => {
    const { stock, cached } = await differential((f) => {
      let parent = f.group('site')
      for (const name of ['building', 'level', 'wall']) {
        const child = f.group(name)
        parent.add(child)
        parent = child
      }
      for (let i = 0; i < 16; i++) parent.add(f.mesh(`mesh-${i}`))
      f.send('onPointerMove')
    })
    expect([...stock.calls.values()]).toEqual(Array(16).fill(5))
    expect([...cached.calls.values()]).toEqual(Array(16).fill(1))
    console.log(
      'Nested fixture / pointermove: stock = 80 mesh raycast tests; cached = 16 (16 unique meshes).',
    )
  })
})
