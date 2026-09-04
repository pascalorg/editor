'use client'

import {
  type AnyNode,
  type AnyNodeId,
  emitter,
  type GridEvent,
  type NodeEvent,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { getHistoryCommandState, useEditor, useInteractionScope } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useThree } from '@react-three/fiber'
import { useXR } from '@react-three/xr'
import { useEffect } from 'react'
import { Box3, Object3D, Quaternion, Raycaster, Vector3 } from 'three'
import { getEmulatedXRDevice } from '@/lib/xr/emulator'
import { resolveEmulatedInputPose } from '@/lib/xr/emulator-ray'
import { useXRWandPanelSettings } from '@/lib/xr/wand-panel-settings'

type InputKind = 'controller' | 'hand'

const XR_INPUT_EVENT_TIMEOUT_MS = 150
const XR_FRAME_TIMEOUT_MS = 100

export type XREmulatorTestHarness = {
  aimAt: (name: string, inputKind?: InputKind) => Promise<boolean>
  aimAtNode: (nodeId: string, inputKind?: InputKind, distance?: number) => Promise<boolean>
  click: (name: string, inputKind?: InputKind) => Promise<boolean>
  clickLevelPoint: (point: [number, number], inputKind?: InputKind) => Promise<boolean>
  clickNode: (nodeId: string, inputKind?: InputKind) => Promise<boolean>
  clickNodeSurface: (nodeId: string, inputKind?: InputKind) => Promise<boolean>
  drag: (names: string[], inputKind?: InputKind) => Promise<boolean>
  dragNodeTo: (
    nodeId: string,
    worldPoint: [number, number, number],
    inputKind?: InputKind,
  ) => Promise<boolean>
  listSceneNodes: () => { id: string; parentId: string | null; type: string }[]
  listSpatialTargets: () => string[]
  panGodView: (delta: [number, number, number]) => Promise<boolean>
  placeToolOnGrid: (
    toolTarget: string,
    nodeType: string,
    points: [number, number][],
    inputKind?: InputKind,
  ) => Promise<{
    activated: boolean
    cancelled: boolean
    createdNodeIds: string[]
    deliveredPoints: number
  }>
  placeToolOnNode: (
    toolTarget: string,
    hostNodeId: string,
    nodeType: string,
    inputKind?: InputKind,
  ) => Promise<{
    activated: boolean
    attachedToHost: boolean
    cancelled: boolean
    createdNodeIds: string[]
    deliveredHostClick: boolean
  }>
  probe: (name: string, inputKind?: InputKind) => Promise<Record<string, unknown>>
  probeNode: (
    nodeId: string,
    inputKind?: InputKind,
    distance?: number,
  ) => Promise<Record<string, unknown>>
  readNode: (nodeId: string) => AnyNode | undefined
  sculptLevelPoints: (points: [number, number][], inputKind?: InputKind) => Promise<boolean>
  snapshot: () => {
    activePaintMaterial: string | null
    hoveredTarget?: string
    history: { canRedo: boolean; canUndo: boolean; mode: string; status: string }
    godViewTransform: { position: number[]; rotationY: number; scale: number[] } | null
    lastGridEvent?: string
    lastNodeEvent?: string
    lastPointerEvent?: string
    levelId: string | null
    mode: string
    nodeCounts: Record<string, number>
    paintEraser: boolean
    paintHover: { nodeNoun: string; scopes: string[]; slotLabel: string } | null
    paintScope: string
    terrainBrush: { falloff: number; radius: number; shape: string; strength: number }
    terrainSampling: boolean
    terrainVerb: string
    wandPanelScale: number
    wallSnappingMode: string
    scope: string
    selectedIds: string[]
    siteHasTerrain: boolean
    tool: string | null
    toolDefaults: Record<string, unknown>
  }
  version: 1
}

declare global {
  var __pascalXRLastGridEvent: string | undefined
  var __pascalXRLastNodeEvent: string | undefined
  var __pascalXRTestHarness: XREmulatorTestHarness | undefined
}

export function XREmulatorTestHarnessBridge() {
  const scene = useThree((state) => state.scene)
  const camera = useThree((state) => state.camera)
  const origin = useXR((state) => state.origin)
  const session = useXR((state) => state.session)

  useEffect(() => {
    if (!(origin && session && process.env.NODE_ENV === 'development')) return

    const recordNodeClick = (event: NodeEvent) => {
      globalThis.__pascalXRLastNodeEvent = `click:${event.node.id}`
    }
    const recordNodeDown = (event: NodeEvent) => {
      globalThis.__pascalXRLastNodeEvent = `down:${event.node.id}`
    }
    const recordGridClick = (event: GridEvent) => {
      globalThis.__pascalXRLastGridEvent = `click:${event.localPosition.join(',')}`
    }
    emitter.on('node:click', recordNodeClick)
    emitter.on('node:pointerdown', recordNodeDown)
    emitter.on('grid:click', recordGridClick)

    const waitForXRFrames = (count = 1) =>
      new Promise<void>((resolve) => {
        const timeout = window.setTimeout(resolve, XR_FRAME_TIMEOUT_MS)
        const next = (remaining: number) => {
          session.requestAnimationFrame(() => {
            if (remaining === 1) {
              window.clearTimeout(timeout)
              resolve()
            } else next(remaining - 1)
          })
        }
        next(count)
      })

    const prepareInput = async (inputKind: InputKind) => {
      const device = getEmulatedXRDevice()
      if (!device) return false
      const deviceId = `${inputKind}-right`
      const inputModeChanged = device.primaryInputMode !== inputKind
      if (inputModeChanged) {
        await device.remote.dispatch('set_input_mode', { mode: inputKind })
      }
      await device.remote.dispatch('set_connected', {
        connected: true,
        device: `${inputKind}-left`,
      })
      await device.remote.dispatch('set_connected', { connected: true, device: deviceId })
      const leftPosition =
        inputKind === 'controller' ? { x: -0.25, y: 1.5, z: -0.4 } : { x: -0.15, y: 1.3, z: -0.4 }
      await device.remote.dispatch('set_transform', {
        device: `${inputKind}-left`,
        orientation: { w: 1, x: 0, y: 0, z: 0 },
        position: leftPosition,
      })
      await waitForXRFrames(inputModeChanged ? 2 : 1)
      return true
    }

    const setInputPose = async (target: Object3D, inputKind: InputKind, distance = 0.5) => {
      const device = getEmulatedXRDevice()
      if (!device) return false
      const pose = resolveEmulatedInputPose(target, origin, distance)
      const deviceId = `${inputKind}-right`
      await device.remote.dispatch('set_transform', {
        device: deviceId,
        orientation: {
          w: pose.quaternion[3],
          x: pose.quaternion[0],
          y: pose.quaternion[1],
          z: pose.quaternion[2],
        },
        position: { x: pose.position[0], y: pose.position[1], z: pose.position[2] },
      })
      await waitForXRFrames()
      return true
    }

    const findTarget = (name: string) => {
      const matches: Object3D[] = []
      scene.traverseVisible((object) => {
        if (object.name === name) matches.push(object)
      })
      return matches[0]
    }

    const waitForTarget = async (name: string) => {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const target = findTarget(name)
        if (target) return target
        await waitForXRFrames()
      }
      return undefined
    }

    const aimAt = async (name: string, inputKind: InputKind = 'controller') => {
      globalThis.__pascalXRHoveredTarget = undefined
      if (!(await prepareInput(inputKind))) return false
      const target = await waitForTarget(name)
      if (!(target && (await setInputPose(target, inputKind)))) return false
      if (inputKind === 'hand') return true
      for (let attempt = 0; attempt < 5; attempt += 1) {
        if (globalThis.__pascalXRHoveredTarget === name) return true
        await waitForXRFrames()
      }
      return findTarget(name) === target
    }

    const aimAtNode = async (
      nodeId: string,
      inputKind: InputKind = 'controller',
      distance = 1.25,
    ) => {
      if (!(await prepareInput(inputKind))) return false
      const device = getEmulatedXRDevice()
      if (!device) return false
      await device.remote.dispatch('set_transform', {
        device: `${inputKind}-left`,
        orientation: { w: 1, x: 0, y: 0, z: 0 },
        position: { x: -3, y: 1.5, z: 0 },
      })
      await waitForXRFrames()
      const registered = sceneRegistry.nodes.get(nodeId)
      if (!registered) return false
      registered.updateWorldMatrix(true, true)
      const bounds = new Box3().setFromObject(registered)
      const target = new Object3D()
      let targetDistance = distance
      if (bounds.isEmpty()) {
        const node = useScene.getState().nodes[nodeId as AnyNodeId]
        const vertices = (
          node as { topology?: { vertices?: { position?: number[] }[] } } | undefined
        )?.topology?.vertices
        const positions = vertices
          ?.map((vertex) => vertex.position)
          .filter(
            (position): position is [number, number, number] =>
              position?.length === 3 && position.every(Number.isFinite),
          )
        if (positions && positions.length > 0) {
          const localBounds = new Box3().setFromPoints(
            positions.map((position) => new Vector3().fromArray(position)),
          )
          localBounds.getCenter(target.position)
          registered.localToWorld(target.position)
          const worldScale = registered.getWorldScale(new Vector3())
          targetDistance = Math.max(
            targetDistance,
            localBounds.getSize(new Vector3()).multiply(worldScale).length() / 2 + 0.25,
          )
        } else {
          registered.getWorldPosition(target.position)
        }
      } else {
        bounds.getCenter(target.position)
        targetDistance = Math.max(targetDistance, bounds.getSize(new Vector3()).length() / 2 + 0.25)
      }
      const normal = camera.getWorldPosition(new Vector3()).sub(target.position).normalize()
      target.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), normal)
      target.updateMatrixWorld(true)
      const positioned = await setInputPose(target, inputKind, targetDistance)
      if (positioned) await waitForXRFrames(2)
      return positioned
    }

    const setSelectValue = async (value: number, inputKind: InputKind) => {
      const device = getEmulatedXRDevice()
      if (!device) return false
      await device.remote.dispatch('set_select_value', {
        device: `${inputKind}-right`,
        value,
      })
      return true
    }

    const waitForInputEvent = (inputKind: InputKind, eventType: 'selectend' | 'selectstart') =>
      new Promise<boolean>((resolve) => {
        const timeout = window.setTimeout(() => {
          session.removeEventListener(eventType, listener)
          resolve(false)
        }, XR_INPUT_EVENT_TIMEOUT_MS)
        const listener = (event: XRInputSourceEvent) => {
          const matchesKind =
            inputKind === 'hand' ? event.inputSource.hand != null : !event.inputSource.hand
          if (event.inputSource.handedness !== 'right' || !matchesKind) return
          window.clearTimeout(timeout)
          session.removeEventListener(eventType, listener)
          resolve(true)
        }
        session.addEventListener(eventType, listener)
      })

    const setSelectValueAndWait = async (
      value: 0 | 1,
      inputKind: InputKind,
      eventType: 'selectend' | 'selectstart',
    ) => {
      const eventReceived = waitForInputEvent(inputKind, eventType)
      if (!(await setSelectValue(value, inputKind))) return false
      await waitForXRFrames(2)
      await eventReceived
      return eventReceived
    }

    const click = async (name: string, inputKind: InputKind = 'controller') => {
      if (!(await aimAt(name, inputKind))) return false
      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (attempt > 0 && !(await aimAt(name, inputKind))) return false
        globalThis.__pascalXRLastPointerEvent = undefined
        await setSelectValueAndWait(1, inputKind, 'selectstart')
        await setSelectValueAndWait(0, inputKind, 'selectend')
        if (globalThis.__pascalXRLastPointerEvent === `click:${name}`) return true
      }
      return false
    }

    const panGodView = async (delta: [number, number, number]) => {
      if (!(await prepareInput('controller'))) return false
      const device = getEmulatedXRDevice()
      const root = findTarget('xr-player-scene-root')
      if (!(device && root)) return false
      const deviceId = 'controller-right'
      const transform = (await device.remote.dispatch('get_transform', { device: deviceId })) as {
        orientation: { w: number; x: number; y: number; z: number }
        position: { x: number; y: number; z: number }
      }
      await device.remote.dispatch('set_gamepad_state', {
        buttons: [{ index: 1, value: 1 }],
        device: deviceId,
      })
      await waitForXRFrames(2)
      await device.remote.dispatch('set_transform', {
        device: deviceId,
        orientation: transform.orientation,
        position: {
          x: transform.position.x + delta[0],
          y: transform.position.y + delta[1],
          z: transform.position.z + delta[2],
        },
      })
      await waitForXRFrames(2)
      await device.remote.dispatch('set_gamepad_state', {
        buttons: [{ index: 1, value: 0 }],
        device: deviceId,
      })
      await waitForXRFrames()
      return root.position.lengthSq() > 0.000_001
    }

    const clickLevelPoint = async (
      point: [number, number],
      inputKind: InputKind = 'controller',
    ) => {
      if (!(await prepareInput(inputKind))) return false
      const levelId = useViewer.getState().selection.levelId
      const levelNode = levelId ? useScene.getState().nodes[levelId] : undefined
      const levelObject = levelId ? sceneRegistry.nodes.get(levelId) : undefined
      const device = getEmulatedXRDevice()
      if (levelNode?.type !== 'level' || !device) return false
      await device.remote.dispatch('set_transform', {
        device: `${inputKind}-left`,
        orientation: { w: 1, x: 0, y: 0, z: 0 },
        position: { x: -3, y: 1.5, z: 0 },
      })
      const buildingObject = levelNode.parentId
        ? sceneRegistry.nodes.get(levelNode.parentId)
        : undefined
      levelObject?.updateWorldMatrix(true, false)
      buildingObject?.updateWorldMatrix(true, false)
      const target = new Object3D()
      const localPoint = new Vector3(point[0], levelNode.baseElevation, point[1])
      target.position.copy(
        levelObject
          ? levelObject.localToWorld(new Vector3(point[0], 0, point[1]))
          : buildingObject
            ? buildingObject.localToWorld(localPoint)
            : localPoint,
      )
      const normal = new Vector3(0, 1, 0)
      if (levelObject) normal.transformDirection(levelObject.matrixWorld)
      else if (buildingObject) normal.transformDirection(buildingObject.matrixWorld)
      target.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), normal)
      target.updateMatrixWorld(true)
      if (!(await setInputPose(target, inputKind, 1.25))) return false
      await waitForXRFrames(2)
      globalThis.__pascalXRLastGridEvent = undefined
      await setSelectValueAndWait(1, inputKind, 'selectstart')
      await setSelectValueAndWait(0, inputKind, 'selectend')
      await waitForXRFrames(2)
      const lastGridEvent = globalThis.__pascalXRLastGridEvent as string | undefined
      return lastGridEvent?.startsWith('click:') === true
    }

    const clickNode = async (nodeId: string, inputKind: InputKind = 'controller') => {
      if (!(await aimAtNode(nodeId, inputKind))) return false
      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (attempt > 0 && !(await aimAtNode(nodeId, inputKind))) return false
        await setSelectValueAndWait(1, inputKind, 'selectstart')
        await setSelectValueAndWait(0, inputKind, 'selectend')
        if (useViewer.getState().selection.selectedIds.includes(nodeId)) return true
      }
      return false
    }

    const sculptLevelPoints = async (
      points: [number, number][],
      inputKind: InputKind = 'controller',
    ) => {
      const first = points[0]
      if (!(first && (await prepareInput(inputKind)))) return false
      const levelId = useViewer.getState().selection.levelId
      const levelNode = levelId ? useScene.getState().nodes[levelId] : undefined
      const device = getEmulatedXRDevice()
      if (levelNode?.type !== 'level' || !device) return false
      const buildingObject = levelNode.parentId
        ? sceneRegistry.nodes.get(levelNode.parentId)
        : undefined
      buildingObject?.updateWorldMatrix(true, false)
      const setPoint = async (point: [number, number]) => {
        const target = new Object3D()
        const localPoint = new Vector3(point[0], levelNode.baseElevation, point[1])
        target.position.copy(buildingObject ? buildingObject.localToWorld(localPoint) : localPoint)
        const normal = new Vector3(0, 1, 0)
        if (buildingObject) normal.transformDirection(buildingObject.matrixWorld)
        target.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), normal)
        target.updateMatrixWorld(true)
        return setInputPose(target, inputKind, 1.25)
      }
      const siteId = useScene.getState().rootNodeIds[0]
      const beforeSite = siteId ? useScene.getState().nodes[siteId] : undefined
      const before = beforeSite?.type === 'site' ? beforeSite.terrain : undefined
      if (!(await setPoint(first))) return false
      if (!(await setSelectValueAndWait(1, inputKind, 'selectstart'))) return false
      for (const point of points.slice(1)) {
        if (!(await setPoint(point))) {
          await setSelectValue(0, inputKind)
          return false
        }
        await waitForXRFrames(2)
      }
      if (!(await setSelectValueAndWait(0, inputKind, 'selectend'))) return false
      await waitForXRFrames(2)
      const afterSite = siteId ? useScene.getState().nodes[siteId] : undefined
      const after = afterSite?.type === 'site' ? afterSite.terrain : undefined
      return JSON.stringify(after) !== JSON.stringify(before)
    }

    const clickNodeSurface = async (nodeId: string, inputKind: InputKind = 'controller') => {
      const aimAtNodeFace = async () => {
        if (!(await prepareInput(inputKind))) return false
        const registered = sceneRegistry.nodes.get(nodeId)
        const device = getEmulatedXRDevice()
        if (!(registered && device)) return false
        await device.remote.dispatch('set_transform', {
          device: `${inputKind}-left`,
          orientation: { w: 1, x: 0, y: 0, z: 0 },
          position: { x: -3, y: 1.5, z: 0 },
        })
        registered.updateWorldMatrix(true, true)
        const target = new Object3D()
        const bounds = new Box3().setFromObject(registered)
        if (bounds.isEmpty()) registered.getWorldPosition(target.position)
        else bounds.getCenter(target.position)
        registered.getWorldQuaternion(target.quaternion)
        target.updateMatrixWorld(true)
        const positioned = await setInputPose(target, inputKind, 0.2)
        if (positioned) await waitForXRFrames(2)
        return positioned
      }

      if (!(await aimAtNodeFace())) return false
      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (attempt > 0 && !(await aimAtNodeFace())) return false
        globalThis.__pascalXRLastNodeEvent = undefined
        await setSelectValueAndWait(1, inputKind, 'selectstart')
        await setSelectValueAndWait(0, inputKind, 'selectend')
        await waitForXRFrames(2)
        if (globalThis.__pascalXRLastNodeEvent === `click:${nodeId}`) return true
      }
      return false
    }

    const drag = async (names: string[], inputKind: InputKind = 'controller') => {
      const first = names[0]
      if (!(first && (await aimAt(first, inputKind)))) return false
      await setSelectValueAndWait(1, inputKind, 'selectstart')
      await waitForXRFrames(2)
      for (const name of names.slice(1)) {
        if (!(await aimAt(name, inputKind))) {
          await setSelectValue(0, inputKind)
          return false
        }
      }
      await setSelectValueAndWait(0, inputKind, 'selectend')
      await waitForXRFrames()
      return globalThis.__pascalXRLastPointerEvent === `click:${names.at(-1)}`
    }

    const dragNodeTo = async (
      nodeId: string,
      worldPoint: [number, number, number],
      inputKind: InputKind = 'controller',
    ) => {
      const registered = sceneRegistry.nodes.get(nodeId)
      if (!registered) return false
      if (!useViewer.getState().selection.selectedIds.includes(nodeId)) {
        if (!(await clickNode(nodeId, inputKind))) return false
      }
      const initialNodeState = JSON.stringify(useScene.getState().nodes[nodeId as AnyNodeId])
      if (!(await aimAtNode(nodeId, inputKind))) return false
      await setSelectValueAndWait(1, inputKind, 'selectstart')
      await waitForXRFrames(2)
      const floorTarget = new Object3D()
      floorTarget.position.fromArray(worldPoint)
      floorTarget.rotation.x = -Math.PI / 2
      floorTarget.updateMatrixWorld(true)
      await setInputPose(floorTarget, inputKind, 1.25)
      await waitForXRFrames(2)
      await setSelectValueAndWait(0, inputKind, 'selectend')
      await waitForXRFrames()
      return JSON.stringify(useScene.getState().nodes[nodeId as AnyNodeId]) !== initialNodeState
    }

    const probe = async (name: string, inputKind: InputKind = 'controller') => {
      const device = getEmulatedXRDevice()
      if (!device) return { error: 'missing device' }
      await aimAt(name, inputKind)
      const target = findTarget(name)
      if (!target) return { error: 'missing target' }
      const transform = (await device.remote.dispatch('get_transform', {
        device: `${inputKind}-right`,
      })) as {
        orientation: { w: number; x: number; y: number; z: number }
        position: { x: number; y: number; z: number }
      }
      const rayOrigin = new Vector3(
        transform.position.x,
        transform.position.y,
        transform.position.z,
      ).applyMatrix4(origin.matrixWorld)
      const rayDirection = new Vector3(0, 0, -1)
        .applyQuaternion(
          new Quaternion(
            transform.orientation.x,
            transform.orientation.y,
            transform.orientation.z,
            transform.orientation.w,
          ),
        )
        .transformDirection(origin.matrixWorld)
      const raycaster = new Raycaster(rayOrigin, rayDirection)
      raycaster.layers.enableAll()
      return {
        rayDirection: rayDirection.toArray(),
        rayOrigin: rayOrigin.toArray(),
        targetPosition: target.getWorldPosition(new Vector3()).toArray(),
        firstHits: raycaster
          .intersectObjects(scene.children, true)
          .slice(0, 8)
          .map((hit) => ({ distance: hit.distance, name: hit.object.name })),
        targetHits: raycaster.intersectObject(target, false).length,
      }
    }

    const probeNode = async (
      nodeId: string,
      inputKind: InputKind = 'controller',
      distance = 1.25,
    ) => {
      const registered = sceneRegistry.nodes.get(nodeId)
      const device = getEmulatedXRDevice()
      if (!(registered && device && (await aimAtNode(nodeId, inputKind, distance)))) {
        return { error: 'missing node or device' }
      }
      const transform = (await device.remote.dispatch('get_transform', {
        device: `${inputKind}-right`,
      })) as {
        orientation: { w: number; x: number; y: number; z: number }
        position: { x: number; y: number; z: number }
      }
      const rayOrigin = new Vector3(
        transform.position.x,
        transform.position.y,
        transform.position.z,
      ).applyMatrix4(origin.matrixWorld)
      const rayDirection = new Vector3(0, 0, -1)
        .applyQuaternion(
          new Quaternion(
            transform.orientation.x,
            transform.orientation.y,
            transform.orientation.z,
            transform.orientation.w,
          ),
        )
        .transformDirection(origin.matrixWorld)
      const raycaster = new Raycaster(rayOrigin, rayDirection)
      raycaster.layers.enableAll()
      registered.updateWorldMatrix(true, true)
      const registeredBounds = new Box3().setFromObject(registered)
      const describeHit = (object: Object3D) => {
        const path: { childTargets: string[]; eventCount: number; name: string; type: string }[] =
          []
        let current: Object3D | null = object
        while (current && path.length < 8) {
          path.push({
            childTargets: current.children
              .filter(
                (child) =>
                  ((child as Object3D & { __r3f?: { eventCount?: number } }).__r3f?.eventCount ??
                    0) > 0,
              )
              .map((child) => child.name || child.type),
            eventCount:
              (current as Object3D & { __r3f?: { eventCount?: number } }).__r3f?.eventCount ?? 0,
            name: current.name,
            type: current.type,
          })
          current = current.parent
        }
        return path
      }
      return {
        bounds: registeredBounds.isEmpty()
          ? null
          : {
              max: registeredBounds.max.toArray(),
              min: registeredBounds.min.toArray(),
            },
        childCount: registered.children.length,
        firstHits: raycaster
          .intersectObjects(scene.children, true)
          .slice(0, 8)
          .map((hit) => ({
            distance: hit.distance,
            name: hit.object.name,
            path: describeHit(hit.object),
          })),
        nodeHits: raycaster.intersectObject(registered, true).length,
        rayDirection: rayDirection.toArray(),
        rayOrigin: rayOrigin.toArray(),
        registeredPosition: registered.getWorldPosition(new Vector3()).toArray(),
      }
    }

    const harness: XREmulatorTestHarness = {
      aimAt,
      aimAtNode,
      click,
      clickLevelPoint,
      clickNode,
      clickNodeSurface,
      drag,
      dragNodeTo,
      listSceneNodes: () =>
        Object.values(useScene.getState().nodes)
          .filter((node): node is NonNullable<typeof node> => node != null)
          .map((node) => ({ id: node.id, parentId: node.parentId, type: node.type }))
          .sort((a, b) => a.type.localeCompare(b.type) || a.id.localeCompare(b.id)),
      listSpatialTargets: () => {
        const names = new Set<string>()
        scene.traverseVisible((object) => {
          if (object.name.startsWith('xr-') && 'raycast' in object) names.add(object.name)
        })
        return [...names].sort()
      },
      placeToolOnGrid: async (toolTarget, nodeType, points, inputKind = 'controller') => {
        const before = new Set(
          Object.values(useScene.getState().nodes)
            .filter((node) => node?.type === nodeType)
            .map((node) => node!.id),
        )
        const activated = await click(toolTarget, inputKind)
        let deliveredPoints = 0
        if (activated) {
          await waitForXRFrames(2)
          for (const point of points) {
            if (!(await clickLevelPoint(point, inputKind))) break
            deliveredPoints += 1
          }
        }
        const createdNodeIds = Object.values(useScene.getState().nodes)
          .filter((node): node is AnyNode => node?.type === nodeType && !before.has(node.id))
          .map((node) => node.id)
        const cancelled = await click('xr-build-tool-select', inputKind)
        return { activated, cancelled, createdNodeIds, deliveredPoints }
      },
      placeToolOnNode: async (toolTarget, hostNodeId, nodeType, inputKind = 'controller') => {
        const before = new Set(
          Object.values(useScene.getState().nodes)
            .filter((node) => node?.type === nodeType)
            .map((node) => node!.id),
        )
        const activated = await click(toolTarget, inputKind)
        if (activated) await waitForXRFrames(2)
        const deliveredHostClick = activated && (await clickNodeSurface(hostNodeId, inputKind))
        const createdNodes = Object.values(useScene.getState().nodes).filter(
          (node): node is AnyNode => node?.type === nodeType && !before.has(node.id),
        )
        const attachedToHost =
          createdNodes.length > 0 && createdNodes.every((node) => node.parentId === hostNodeId)
        const alreadySelect =
          useEditor.getState().mode === 'select' && useEditor.getState().tool === null
        const cancelled = alreadySelect || (await click('xr-build-tool-select', inputKind))
        return {
          activated,
          attachedToHost,
          cancelled,
          createdNodeIds: createdNodes.map((node) => node.id),
          deliveredHostClick,
        }
      },
      panGodView,
      probe,
      probeNode,
      readNode: (nodeId) => useScene.getState().nodes[nodeId as AnyNode['id']],
      sculptLevelPoints,
      snapshot: () => {
        const godViewRoot = findTarget('xr-player-scene-root')
        const nodeCounts: Record<string, number> = {}
        for (const node of Object.values(useScene.getState().nodes)) {
          if (node) nodeCounts[node.type] = (nodeCounts[node.type] ?? 0) + 1
        }
        return {
          activePaintMaterial: useEditor.getState().activePaintMaterial?.materialPreset ?? null,
          godViewTransform: godViewRoot
            ? {
                position: godViewRoot.position.toArray(),
                rotationY: godViewRoot.rotation.y,
                scale: godViewRoot.scale.toArray(),
              }
            : null,
          history: getHistoryCommandState(),
          hoveredTarget: globalThis.__pascalXRHoveredTarget,
          lastGridEvent: globalThis.__pascalXRLastGridEvent,
          lastNodeEvent: globalThis.__pascalXRLastNodeEvent,
          lastPointerEvent: globalThis.__pascalXRLastPointerEvent,
          levelId: useViewer.getState().selection.levelId,
          mode: useEditor.getState().mode,
          nodeCounts,
          paintEraser: useEditor.getState().paintEraser,
          paintHover: useEditor.getState().paintHover,
          paintScope: useEditor.getState().paintScope,
          terrainBrush: useEditor.getState().terrainBrush,
          terrainSampling: useEditor.getState().terrainSampling,
          terrainVerb: useEditor.getState().terrainVerb,
          wandPanelScale: useXRWandPanelSettings.getState().panelScale,
          wallSnappingMode: useEditor.getState().snappingModeByContext.wall,
          scope: useInteractionScope.getState().scope.kind,
          selectedIds: useViewer.getState().selection.selectedIds,
          siteHasTerrain: Object.values(useScene.getState().nodes).some(
            (node) => node?.type === 'site' && node.terrain !== undefined,
          ),
          tool: useEditor.getState().tool,
          toolDefaults: useEditor.getState().toolDefaults,
        }
      },
      version: 1,
    }
    globalThis.__pascalXRTestHarness = harness
    return () => {
      emitter.off('node:click', recordNodeClick)
      emitter.off('node:pointerdown', recordNodeDown)
      emitter.off('grid:click', recordGridClick)
      if (globalThis.__pascalXRTestHarness === harness) {
        globalThis.__pascalXRTestHarness = undefined
      }
    }
  }, [camera, origin, scene, session])

  return null
}
