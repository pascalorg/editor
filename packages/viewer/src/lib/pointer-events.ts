/*
 * MIT License
 *
 * Copyright (c) 2019-2025 Poimandres
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 *
 * Vendored from R3F 9.6.1:
 * https://raw.githubusercontent.com/pmndrs/react-three-fiber/v9.6.1/packages/fiber/src/core/events.ts
 * Ray collection is cached; camera-drag moves are throttled before stock dispatch.
 * The throttle is a vendored-manager policy; dev ?stockEvents uses untouched R3F.
 */

import {
  events as createWebEvents,
  type DomEvent,
  type EventHandlers,
  type EventManager,
  type Events,
  getRootState,
  type Instance,
  type Intersection,
  type RootState,
  type RootStore,
  type ThreeEvent,
} from '@react-three/fiber'
import * as THREE from 'three'
import { acceleratedRaycast } from 'three-mesh-bvh'
import useViewer from '../store/use-viewer'

// Keep navigation feedback at 10 Hz while avoiding raycasts for intervening moves.
const CAMERA_DRAG_MOVE_INTERVAL_MS = 100

type PointerCaptureTarget = {
  intersection: Intersection
  target: Element
}

const stockIntersectObject = THREE.Raycaster.prototype.intersectObject
const raycasterKeys = new Set(['ray', 'near', 'far', 'camera', 'layers', 'params', 'firstHitOnly'])
const pureRaycast = Symbol('pureRaycast')
const warnedRaycastNames = new Set<string>()
type FallbackReason = { fnName: string; objectName: string; objectType: string }
type PointerEventsStats = {
  events: number
  cachedEvents: number
  fallbackEvents: number
  lastFallbackReason: FallbackReason | null
}
const supportedRaycasts = new Set([
  THREE.Object3D.prototype.raycast,
  THREE.Mesh.prototype.raycast,
  THREE.SkinnedMesh.prototype.raycast,
  THREE.InstancedMesh.prototype.raycast,
  THREE.BatchedMesh.prototype.raycast,
  THREE.Line.prototype.raycast,
  THREE.LineSegments.prototype.raycast,
  THREE.Points.prototype.raycast,
  THREE.Sprite.prototype.raycast,
  THREE.LOD.prototype.raycast,
  acceleratedRaycast,
])

/** Opt in only when the raycast appends hits without reading prior hits or mutating scene/query state. */
export function markPureRaycast<T extends THREE.Object3D['raycast']>(raycast: T): T {
  Object.defineProperty(raycast, pureRaycast, { value: true })
  return raycast
}

function isSupportedRaycast(raycast: THREE.Object3D['raycast']) {
  // Arity admits the repo's many no-ops. Closure-mutating no-arg raycasts are out of scope:
  // JavaScript cannot identify their effects without executing them or requiring every no-op to opt in.
  return (
    raycast.length < 2 ||
    supportedRaycasts.has(raycast) ||
    (raycast as { [pureRaycast]?: boolean })[pureRaycast] === true
  )
}

export function choosePointerEvents(
  search = typeof window !== 'undefined' ? window.location.search : '',
): typeof createWebEvents {
  return process.env.NODE_ENV !== 'production' && new URLSearchParams(search).has('stockEvents')
    ? createWebEvents
    : createPascalPointerEvents
}

function querySnapshot(raycaster: THREE.Raycaster): unknown[] | undefined {
  if (
    Object.getPrototypeOf(raycaster) !== THREE.Raycaster.prototype ||
    raycaster.intersectObject !== stockIntersectObject ||
    Reflect.ownKeys(raycaster).some((key) => typeof key !== 'string' || !raycasterKeys.has(key))
  )
    return undefined

  const { ray, camera, layers, near, far, params } = raycaster
  const snapshot: unknown[] = [
    raycaster,
    camera,
    near,
    far,
    layers.mask,
    ray.origin.x,
    ray.origin.y,
    ray.origin.z,
    ray.direction.x,
    ray.direction.y,
    ray.direction.z,
    raycaster.firstHitOnly,
    ...camera.matrixWorld.elements,
    ...camera.matrixWorldInverse.elements,
    ...camera.projectionMatrix.elements,
    ...camera.projectionMatrixInverse.elements,
  ]
  // Unknown parameter objects can hide mutable query state; use stock recursion for those.
  for (const key of Reflect.ownKeys(params)) {
    const descriptor = Object.getOwnPropertyDescriptor(params, key)!
    const value: unknown = descriptor.value
    if (
      typeof key !== 'string' ||
      descriptor.get ||
      !value ||
      Object.getPrototypeOf(value) !== Object.prototype
    )
      return undefined
    snapshot.push(key, value)
    for (const field of Reflect.ownKeys(value)) {
      const entry = Object.getOwnPropertyDescriptor(value, field)!
      if (
        typeof field !== 'string' ||
        entry.get ||
        (entry.value !== null &&
          !['number', 'string', 'boolean', 'undefined'].includes(typeof entry.value))
      )
        return undefined
      snapshot.push(field, entry.value)
    }
  }
  return snapshot
}

type CachedQuery = {
  generation: number
  snapshot: unknown[] | undefined
  revision: number
  fallback: boolean
  subtrees: WeakMap<THREE.Object3D, { generation: number; start: number; end: number }>
  hits: THREE.Intersection[]
}

function distanceOrder(a: THREE.Intersection, b: THREE.Intersection) {
  return a.distance - b.distance
}

function createCachedRaycast() {
  const queries = new WeakMap<RootState, CachedQuery>()
  const activeQueries: CachedQuery[] = []
  const rootHits: THREE.Intersection[] = []
  let generation = 0
  let revision = 0
  let unsupportedObject: THREE.Object3D | undefined

  function collect(
    object: THREE.Object3D,
    raycaster: THREE.Raycaster,
    query: CachedQuery,
  ): boolean {
    // Only R3F-managed objects can also appear as independently queried event roots.
    const managed = (object as Instance<THREE.Object3D>['object']).__r3f !== undefined
    const cached = managed ? query.subtrees.get(object) : undefined
    const { hits } = query
    if (cached?.generation === generation) {
      for (let i = cached.start; i < cached.end; i++) hits.push(hits[i]!)
      return true
    }
    const start = hits.length
    // Three's runtime accepts false as a recursion barrier, although its declaration says void.
    let result: unknown
    if (object.layers.test(raycaster.layers)) {
      if (!isSupportedRaycast(object.raycast)) {
        unsupportedObject = object
        return false
      }
      result = object.raycast(raycaster, hits)
    }
    if (result !== false) {
      const children = object.children
      for (let i = 0, length = children.length; i < length; i++) {
        if (!collect(children[i]!, raycaster, query)) return false
      }
    }
    if (cached) {
      cached.generation = generation
      cached.start = start
      cached.end = hits.length
    } else if (managed) {
      query.subtrees.set(object, { generation, start, end: hits.length })
    }
    return true
  }

  return {
    get unsupportedObject() {
      return unsupportedObject
    },
    clear() {
      unsupportedObject = undefined
      generation++
      revision = 0
      for (const query of activeQueries) {
        query.hits.length = 0
        query.snapshot = undefined
      }
      activeQueries.length = 0
      rootHits.length = 0
    },
    intersectObject(object: THREE.Object3D, state: RootState) {
      const { raycaster } = state
      let query = queries.get(state)
      if (!query) {
        query = {
          generation: -1,
          snapshot: undefined,
          revision: -1,
          fallback: false,
          subtrees: new WeakMap(),
          hits: [],
        }
        queries.set(state, query)
      }
      if (query.generation !== generation) {
        query.generation = generation
        query.snapshot = querySnapshot(raycaster)
        query.fallback = !query.snapshot
        query.revision = revision
        activeQueries.push(query)
      } else if (query.revision !== revision && !query.fallback) {
        // Any layer can mutate another query; cached replay alone cannot change it.
        const snapshot = querySnapshot(raycaster)
        query.fallback =
          !snapshot ||
          snapshot.length !== query.snapshot!.length ||
          snapshot.some((value, index) => !Object.is(value, query!.snapshot![index]))
        query.revision = revision
      }
      if (query.fallback) return undefined

      let range = query.subtrees.get(object)
      if (range?.generation !== generation) {
        revision++
        if (!collect(object, raycaster, query)) return undefined
        range = query.subtrees.get(object)!
      }
      // Sorting must not disturb subtree emission order, including equal-distance hits.
      rootHits.length = 0
      for (let i = range.start; i < range.end; i++) rootHits.push(query.hits[i]!)
      if (rootHits.length > 1) rootHits.sort(distanceOrder)
      return rootHits
    },
  }
}

export function createPascalPointerEvents(store: RootStore): EventManager<HTMLElement> {
  const manager = createWebEvents(store)
  const { handlePointer } = createEvents(store)
  for (const name of Object.keys(manager.handlers!) as (keyof Events)[]) {
    manager.handlers![name] = handlePointer(name) as Events[typeof name]
  }
  const move = manager.handlers!.onPointerMove
  let lastCameraDragMove = Number.NEGATIVE_INFINITY
  manager.handlers!.onPointerMove = (event) => {
    if (useViewer.getState().cameraDragging) {
      const now = performance.now()
      if (now - lastCameraDragMove < CAMERA_DRAG_MOVE_INTERVAL_MS) return
      lastCameraDragMove = now
    } else {
      lastCameraDragMove = Number.NEGATIVE_INFINITY
    }
    move(event)
  }
  return manager
}

function makeId(event: Intersection) {
  // biome-ignore lint/style/useTemplate: Keep the vendored dispatch identical to R3F 9.6.1.
  return (event.eventObject || event.object).uuid + '/' + event.index + event.instanceId
}

/**
 * Release pointer captures.
 * This is called by releasePointerCapture in the API, and when an object is removed.
 */
function releaseInternalPointerCapture(
  capturedMap: Map<number, Map<THREE.Object3D, PointerCaptureTarget>>,
  obj: THREE.Object3D,
  captures: Map<THREE.Object3D, PointerCaptureTarget>,
  pointerId: number,
): void {
  const captureData: PointerCaptureTarget | undefined = captures.get(obj)
  if (captureData) {
    captures.delete(obj)
    // If this was the last capturing object for this pointer
    if (captures.size === 0) {
      capturedMap.delete(pointerId)
      captureData.target.releasePointerCapture(pointerId)
    }
  }
}

function createEvents(store: RootStore) {
  const stats: PointerEventsStats = {
    events: 0,
    cachedEvents: 0,
    fallbackEvents: 0,
    lastFallbackReason: null,
  }
  if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('perf')) {
    ;(
      window as unknown as { __pointerEvents?: { stats: () => PointerEventsStats } }
    ).__pointerEvents = {
      stats: () => ({
        ...stats,
        lastFallbackReason: stats.lastFallbackReason ? { ...stats.lastFallbackReason } : null,
      }),
    }
  }
  // Nested pointer events from raycast/compute callbacks need separate scratch storage.
  const collectors: ReturnType<typeof createCachedRaycast>[] = []
  let collectionDepth = 0

  /** Calculates delta */
  function calculateDistance(event: DomEvent) {
    const { internal } = store.getState()
    const dx = event.offsetX - internal.initialClick[0]
    const dy = event.offsetY - internal.initialClick[1]
    return Math.round(Math.sqrt(dx * dx + dy * dy))
  }

  /** Returns true if an instance has a valid pointer-event registered, this excludes scroll, clicks etc */
  function filterPointerEvents(objects: THREE.Object3D[]) {
    return objects.filter((obj) => {
      const handlers = (obj as Instance<THREE.Object3D>['object']).__r3f?.handlers
      return (
        handlers &&
        (handlers.onPointerMove ||
          handlers.onPointerOver ||
          handlers.onPointerEnter ||
          handlers.onPointerOut ||
          handlers.onPointerLeave)
      )
    })
  }

  function intersect(event: DomEvent, filter?: (objects: THREE.Object3D[]) => THREE.Object3D[]) {
    stats.events++
    const state = store.getState()
    const duplicates = new Set<string>()
    const intersections: Intersection[] = []
    // Allow callers to eliminate event objects
    const eventsObjects = filter ? filter(state.internal.interaction) : state.internal.interaction
    // Reset all raycaster cameras to undefined
    for (let i = 0; i < eventsObjects.length; i++) {
      const state = getRootState(eventsObjects[i]!)
      if (state) {
        state.raycaster.camera = undefined!
      }
    }

    if (!state.previousRoot) {
      // Make sure root-level pointer and ray are set up
      state.events.compute?.(event, state)
    }

    collectors[collectionDepth] ??= createCachedRaycast()
    const collector = collectors[collectionDepth++]!
    let hits: THREE.Intersection<THREE.Object3D>[] = []
    let stock = false
    const length = eventsObjects.length
    try {
      for (let i = 0; i < length; i++) {
        if (!(i in eventsObjects)) continue
        const obj = eventsObjects[i]!
        const layer = getRootState(obj)
        if (!layer?.events.enabled || layer.raycaster.camera === null) continue

        if (layer.raycaster.camera === undefined) {
          // A layer compute may mutate another layer or opaque plugin state.
          collector.clear()
          layer.events.compute?.(event, layer, layer.previousRoot?.getState())
          if (layer.raycaster.camera === undefined) layer.raycaster.camera = null!
        }
        if (layer.raycaster.camera) {
          const rootHits = stock
            ? layer.raycaster.intersectObject(obj, true)
            : collector.intersectObject(obj, layer)
          if (!rootHits) {
            const unsupported = collector.unsupportedObject
            const reason = {
              fnName: unsupported
                ? unsupported.raycast.name || '(anonymous)'
                : '(unsupported query)',
              objectName: (unsupported ?? obj).name,
              objectType: (unsupported ?? obj).type,
            }
            stats.fallbackEvents++
            stats.lastFallbackReason = reason
            if (
              unsupported &&
              process.env.NODE_ENV === 'development' &&
              !warnedRaycastNames.has(reason.fnName)
            ) {
              warnedRaycastNames.add(reason.fnName)
              console.warn(
                `[pointer-events] Stock fallback for raycast "${reason.fnName}" on ${reason.objectType} "${reason.objectName}". Use markPureRaycast only after verifying it appends hits without reading prior hits or mutating scene/query state.`,
              )
            }
            // Keep this event-wide flag outside the collector: portal compute also clears its cache.
            stock = true
            collector.clear()
            if (unsupported) {
              // Completed pure roots already match stock order. Retry only the interrupted root
              // with its own accumulator before invoking any unsupported user code.
              i--
            } else {
              hits.length = 0
              i = -1
            }
            continue
          }
          for (let j = 0; j < rootHits.length; j++) hits.push(rootHits[j]!)
        }
      }
    } finally {
      if (!stock) stats.cachedEvents++
      // User filters and dispatch can perform independent raycasts or change the scene.
      collector.clear()
      collectionDepth--
    }

    hits = hits
      .sort((a, b) => {
        const aState = getRootState(a.object)
        const bState = getRootState(b.object)
        if (!aState || !bState) return a.distance - b.distance
        return bState.events.priority - aState.events.priority || a.distance - b.distance
      })
      .filter((item) => {
        const id = makeId(item as Intersection)
        if (duplicates.has(id)) return false
        duplicates.add(id)
        return true
      })

    // https://github.com/mrdoob/three.js/issues/16031
    // Allow custom userland intersect sort order, this likely only makes sense on the root filter
    if (state.events.filter) hits = state.events.filter(hits, state)

    // Bubble up the events, find the event source (eventObject)
    for (const hit of hits) {
      let eventObject: THREE.Object3D | null = hit.object
      // Bubble event up
      while (eventObject) {
        if ((eventObject as Instance<THREE.Object3D>['object']).__r3f?.eventCount)
          intersections.push({ ...hit, eventObject })
        eventObject = eventObject.parent
      }
    }

    // If the interaction is captured, make all capturing targets part of the intersect.
    if ('pointerId' in event && state.internal.capturedMap.has(event.pointerId)) {
      for (let captureData of state.internal.capturedMap.get(event.pointerId)!.values()) {
        if (!duplicates.has(makeId(captureData.intersection)))
          intersections.push(captureData.intersection)
      }
    }
    return intersections
  }

  /**  Handles intersections by forwarding them to handlers */
  function handleIntersects(
    intersections: Intersection[],
    event: DomEvent,
    delta: number,
    callback: (event: ThreeEvent<DomEvent>) => void,
  ) {
    // If anything has been found, forward it to the event listeners
    if (intersections.length) {
      const localState = { stopped: false }
      for (const hit of intersections) {
        let state = getRootState(hit.object)

        // If the object is not managed by R3F, it might be parented to an element which is.
        // Traverse upwards until we find a managed parent and use its state instead.
        if (!state) {
          hit.object.traverseAncestors((obj) => {
            const parentState = getRootState(obj)
            if (parentState) {
              state = parentState
              return false
            }
          })
        }

        if (state) {
          const { raycaster, pointer, camera, internal } = state
          const unprojectedPoint = new THREE.Vector3(pointer.x, pointer.y, 0).unproject(camera)

          const hasPointerCapture = (id: number) =>
            internal.capturedMap.get(id)?.has(hit.eventObject) ?? false

          const setPointerCapture = (id: number) => {
            const captureData = { intersection: hit, target: event.target as Element }
            if (internal.capturedMap.has(id)) {
              // if the pointerId was previously captured, we add the hit to the
              // event capturedMap.
              internal.capturedMap.get(id)!.set(hit.eventObject, captureData)
            } else {
              // if the pointerId was not previously captured, we create a map
              // containing the hitObject, and the hit. hitObject is used for
              // faster access.
              internal.capturedMap.set(id, new Map([[hit.eventObject, captureData]]))
            }
            // Call the original event now
            ;(event.target as Element).setPointerCapture(id)
          }

          const releasePointerCapture = (id: number) => {
            const captures = internal.capturedMap.get(id)
            if (captures) {
              releaseInternalPointerCapture(internal.capturedMap, hit.eventObject, captures, id)
            }
          }

          // Add native event props
          // R3F copies arbitrary native event properties into its public event payload.
          let extractEventProps: any = {}
          // This iterates over the event's properties including the inherited ones. Native PointerEvents have most of their props as getters which are inherited, but polyfilled PointerEvents have them all as their own properties (i.e. not inherited). We can't use Object.keys() or Object.entries() as they only return "own" properties; nor Object.getPrototypeOf(event) as that *doesn't* return "own" properties, only inherited ones.
          for (let prop in event) {
            let property = event[prop as keyof DomEvent]
            // Only copy over atomics, leave functions alone as these should be
            // called as event.nativeEvent.fn()
            if (typeof property !== 'function') extractEventProps[prop] = property
          }

          let raycastEvent: ThreeEvent<DomEvent> = {
            ...hit,
            ...extractEventProps,
            pointer,
            intersections,
            stopped: localState.stopped,
            delta,
            unprojectedPoint,
            ray: raycaster.ray,
            camera: camera,
            // Hijack stopPropagation, which just sets a flag
            stopPropagation() {
              // https://github.com/pmndrs/react-three-fiber/issues/596
              // Events are not allowed to stop propagation if the pointer has been captured
              const capturesForPointer =
                'pointerId' in event && internal.capturedMap.get(event.pointerId)

              // We only authorize stopPropagation...
              if (
                // ...if this pointer hasn't been captured
                !capturesForPointer ||
                // ... or if the hit object is capturing the pointer
                capturesForPointer.has(hit.eventObject)
              ) {
                raycastEvent.stopped = localState.stopped = true
                // Propagation is stopped, remove all other hover records
                // An event handler is only allowed to flush other handlers if it is hovered itself
                if (
                  internal.hovered.size &&
                  Array.from(internal.hovered.values()).find(
                    (i) => i.eventObject === hit.eventObject,
                  )
                ) {
                  // Objects cannot flush out higher up objects that have already caught the event
                  const higher = intersections.slice(0, intersections.indexOf(hit))
                  cancelPointer([...higher, hit])
                }
              }
            },
            // there should be a distinction between target and currentTarget
            target: { hasPointerCapture, setPointerCapture, releasePointerCapture },
            currentTarget: { hasPointerCapture, setPointerCapture, releasePointerCapture },
            nativeEvent: event,
          }

          // Call subscribers
          callback(raycastEvent)
          // Event bubbling may be interrupted by stopPropagation
          if (localState.stopped === true) break
        }
      }
    }
    return intersections
  }

  function cancelPointer(intersections: Intersection[]) {
    const { internal } = store.getState()
    for (const hoveredObj of internal.hovered.values()) {
      // When no objects were hit or the hovered object wasn't found underneath the cursor
      // we call onPointerOut and delete the object from the hovered-elements map
      if (
        !intersections.length ||
        !intersections.find(
          (hit) =>
            hit.object === hoveredObj.object &&
            hit.index === hoveredObj.index &&
            hit.instanceId === hoveredObj.instanceId,
        )
      ) {
        const eventObject = hoveredObj.eventObject
        const instance = (eventObject as Instance<THREE.Object3D>['object']).__r3f
        internal.hovered.delete(makeId(hoveredObj))
        if (instance?.eventCount) {
          const handlers = instance.handlers
          // Clear out intersects, they are outdated by now
          const data = { ...hoveredObj, intersections }
          handlers.onPointerOut?.(data as ThreeEvent<PointerEvent>)
          handlers.onPointerLeave?.(data as ThreeEvent<PointerEvent>)
        }
      }
    }
  }

  function pointerMissed(event: MouseEvent, objects: THREE.Object3D[]) {
    for (let i = 0; i < objects.length; i++) {
      const instance = (objects[i] as Instance<THREE.Object3D>['object']).__r3f
      instance?.handlers.onPointerMissed?.(event)
    }
  }

  function handlePointer(name: string) {
    // Deal with cancelation
    switch (name) {
      case 'onPointerLeave':
      case 'onPointerCancel':
        return () => cancelPointer([])
      case 'onLostPointerCapture':
        return (event: DomEvent) => {
          const { internal } = store.getState()
          if ('pointerId' in event && internal.capturedMap.has(event.pointerId)) {
            // If the object event interface had onLostPointerCapture, we'd call it here on every
            // object that's getting removed. We call it on the next frame because onLostPointerCapture
            // fires before onPointerUp. Otherwise pointerUp would never be called if the event didn't
            // happen in the object it originated from, leaving components in a in-between state.
            requestAnimationFrame(() => {
              // Only release if pointer-up didn't do it already
              if (internal.capturedMap.has(event.pointerId)) {
                internal.capturedMap.delete(event.pointerId)
                cancelPointer([])
              }
            })
          }
        }
    }

    // Any other pointer goes here ...
    return function handleEvent(event: DomEvent) {
      const { onPointerMissed, internal } = store.getState()

      // prepareRay(event)
      internal.lastEvent.current = event

      // Get fresh intersects
      const isPointerMove = name === 'onPointerMove'
      const isClickEvent =
        name === 'onClick' || name === 'onContextMenu' || name === 'onDoubleClick'
      const filter = isPointerMove ? filterPointerEvents : undefined

      const hits = intersect(event, filter)
      const delta = isClickEvent ? calculateDistance(event) : 0

      // Save initial coordinates on pointer-down
      if (name === 'onPointerDown') {
        internal.initialClick = [event.offsetX, event.offsetY]
        internal.initialHits = hits.map((hit) => hit.eventObject)
      }

      // If a click yields no results, pass it back to the user as a miss
      // Missed events have to come first in order to establish user-land side-effect clean up
      if (isClickEvent && !hits.length) {
        if (delta <= 2) {
          pointerMissed(event, internal.interaction)
          if (onPointerMissed) onPointerMissed(event)
        }
      }
      // Take care of unhover
      if (isPointerMove) cancelPointer(hits)

      function onIntersect(data: ThreeEvent<DomEvent>) {
        const eventObject = data.eventObject
        const instance = (eventObject as Instance<THREE.Object3D>['object']).__r3f

        // Check presence of handlers
        if (!instance?.eventCount) return
        const handlers = instance.handlers

        /*
        MAYBE TODO, DELETE IF NOT:
          Check if the object is captured, captured events should not have intersects running in parallel
          But wouldn't it be better to just replace capturedMap with a single entry?
          Also, are we OK with straight up making picking up multiple objects impossible?

        const pointerId = (data as ThreeEvent<PointerEvent>).pointerId
        if (pointerId !== undefined) {
          const capturedMeshSet = internal.capturedMap.get(pointerId)
          if (capturedMeshSet) {
            const captured = capturedMeshSet.get(eventObject)
            if (captured && captured.localState.stopped) return
          }
        }*/

        if (isPointerMove) {
          // Move event ...
          if (
            handlers.onPointerOver ||
            handlers.onPointerEnter ||
            handlers.onPointerOut ||
            handlers.onPointerLeave
          ) {
            // When enter or out is present take care of hover-state
            const id = makeId(data)
            const hoveredItem = internal.hovered.get(id)
            if (!hoveredItem) {
              // If the object wasn't previously hovered, book it and call its handler
              internal.hovered.set(id, data)
              handlers.onPointerOver?.(data as ThreeEvent<PointerEvent>)
              handlers.onPointerEnter?.(data as ThreeEvent<PointerEvent>)
            } else if (hoveredItem.stopped) {
              // If the object was previously hovered and stopped, we shouldn't allow other items to proceed
              data.stopPropagation()
            }
          }
          // Call mouse move
          handlers.onPointerMove?.(data as ThreeEvent<PointerEvent>)
        } else {
          // All other events ...
          const handler = handlers[name as keyof EventHandlers] as (
            event: ThreeEvent<PointerEvent>,
          ) => void
          if (handler) {
            // Forward all events back to their respective handlers with the exception of click events,
            // which must use the initial target
            if (!isClickEvent || internal.initialHits.includes(eventObject)) {
              // Missed events have to come first
              pointerMissed(
                event,
                internal.interaction.filter((object) => !internal.initialHits.includes(object)),
              )
              // Now call the handler
              handler(data as ThreeEvent<PointerEvent>)
            }
          } else {
            // Trigger onPointerMissed on all elements that have pointer over/out handlers, but not click and weren't hit
            if (isClickEvent && internal.initialHits.includes(eventObject)) {
              pointerMissed(
                event,
                internal.interaction.filter((object) => !internal.initialHits.includes(object)),
              )
            }
          }
        }
      }

      handleIntersects(hits, event, delta, onIntersect)
    }
  }

  return { handlePointer }
}
