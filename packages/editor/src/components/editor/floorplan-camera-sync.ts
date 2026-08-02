'use client'

import { type CameraPose, emitter } from '@pascal-app/core'
import { useEffect, useRef } from 'react'
import { subscribeCameraPose } from '../../store/camera-pose-store'
import { subscribeNavigationSyncPose } from '../../store/navigation-sync-pose-store'
import type { NavigationSyncPose, NavigationSyncPoseInput } from '../../store/use-editor'

const POSITION_EPSILON = 0.001
const AZIMUTH_EPSILON = 1e-4
const VIEW_WIDTH_EPSILON = 0.001

type FloorplanNavigationSnapshot = Omit<NavigationSyncPoseInput, 'source'>

function angleDeltaRadians(a: number, b: number) {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b))
}

function normalizeNearZero(value: number) {
  return Math.abs(value) < Number.EPSILON * 10 ? 0 : value
}

function navigationSnapshot(pose: NavigationSyncPoseInput): FloorplanNavigationSnapshot {
  return {
    target: [...pose.target],
    azimuth: pose.azimuth,
    viewWidth: pose.viewWidth,
  }
}

function navigationSnapshotsEqual(
  previous: FloorplanNavigationSnapshot,
  next: FloorplanNavigationSnapshot,
) {
  return (
    Math.abs(previous.target[0] - next.target[0]) < POSITION_EPSILON &&
    Math.abs(previous.target[1] - next.target[1]) < POSITION_EPSILON &&
    Math.abs(previous.target[2] - next.target[2]) < POSITION_EPSILON &&
    Math.abs(angleDeltaRadians(previous.azimuth, next.azimuth)) < AZIMUTH_EPSILON &&
    Math.abs(previous.viewWidth - next.viewWidth) < VIEW_WIDTH_EPSILON
  )
}

export function cameraPoseToFloorplanNavigationPose(
  pose: CameraPose,
): NavigationSyncPoseInput | null {
  if (!(pose.viewWidth !== undefined && Number.isFinite(pose.viewWidth) && pose.viewWidth > 0)) {
    return null
  }

  return {
    source: '3d',
    target: [...pose.target],
    azimuth: Math.atan2(pose.position[0] - pose.target[0], pose.position[2] - pose.target[2]),
    viewWidth: pose.viewWidth,
  }
}

export function floorplanNavigationPoseToCameraPose(
  navigationPose: NavigationSyncPose,
  cameraPose: CameraPose,
): CameraPose {
  const offsetX = cameraPose.position[0] - cameraPose.target[0]
  const offsetY = cameraPose.position[1] - cameraPose.target[1]
  const offsetZ = cameraPose.position[2] - cameraPose.target[2]
  const horizontalDistance = Math.hypot(offsetX, offsetZ)
  const horizontalX = normalizeNearZero(Math.sin(navigationPose.azimuth) * horizontalDistance)
  const horizontalZ = normalizeNearZero(Math.cos(navigationPose.azimuth) * horizontalDistance)
  const target: [number, number, number] = [...navigationPose.target]

  return {
    ...(cameraPose.fov === undefined ? {} : { fov: cameraPose.fov }),
    position: [target[0] + horizontalX, target[1] + offsetY, target[2] + horizontalZ],
    projection: cameraPose.projection,
    target,
    viewWidth: navigationPose.viewWidth,
  }
}

export type FloorplanCameraSyncBridge = {
  receiveCameraPose: (pose: CameraPose) => void
  receiveNavigationPose: (pose: NavigationSyncPose | null) => void
  setActive: (active: boolean) => void
}

export type FloorplanCameraNavigationChannel = {
  publish: (pose: NavigationSyncPoseInput) => void
  subscribe: (listener: (pose: NavigationSyncPose) => void) => () => void
}

export function createFloorplanCameraNavigationChannel(): FloorplanCameraNavigationChannel {
  const listeners = new Set<(pose: NavigationSyncPose) => void>()
  let revision = 0

  return {
    publish: (pose) => {
      revision += 1
      const revisedPose = { ...pose, revision }
      for (const listener of listeners) {
        listener(revisedPose)
      }
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

const liveCameraNavigation = createFloorplanCameraNavigationChannel()

export function subscribeFloorplanCameraNavigation(listener: (pose: NavigationSyncPose) => void) {
  return liveCameraNavigation.subscribe(listener)
}

export function createFloorplanCameraSyncBridge({
  active: initialActive = true,
  applyCameraPose,
  publishNavigationPose,
}: {
  active?: boolean
  applyCameraPose: (pose: CameraPose) => void
  publishNavigationPose: (pose: NavigationSyncPoseInput) => void
}): FloorplanCameraSyncBridge {
  let active = initialActive
  let latestCameraPose: CameraPose | null = null
  let pendingNavigationPose: NavigationSyncPose | null = null
  let lastAppliedNavigationRevision = 0
  let lastPublishedNavigation: FloorplanNavigationSnapshot | null = null

  const applyPendingNavigationPose = () => {
    if (!(latestCameraPose && pendingNavigationPose)) return false
    if (pendingNavigationPose.revision === lastAppliedNavigationRevision) {
      pendingNavigationPose = null
      return false
    }

    const appliedPose = floorplanNavigationPoseToCameraPose(pendingNavigationPose, latestCameraPose)
    const appliedNavigationPose = cameraPoseToFloorplanNavigationPose(appliedPose)
    latestCameraPose = appliedPose
    lastAppliedNavigationRevision = pendingNavigationPose.revision
    pendingNavigationPose = null
    if (appliedNavigationPose) {
      lastPublishedNavigation = navigationSnapshot(appliedNavigationPose)
    }
    applyCameraPose(appliedPose)
    return true
  }

  const publishCameraNavigationPose = (pose: CameraPose) => {
    const navigationPose = cameraPoseToFloorplanNavigationPose(pose)
    if (!navigationPose) return
    const nextSnapshot = navigationSnapshot(navigationPose)
    if (
      lastPublishedNavigation &&
      navigationSnapshotsEqual(lastPublishedNavigation, nextSnapshot)
    ) {
      return
    }

    lastPublishedNavigation = nextSnapshot
    publishNavigationPose(navigationPose)
  }

  return {
    receiveCameraPose: (pose) => {
      latestCameraPose = pose
      if (active && applyPendingNavigationPose()) return

      publishCameraNavigationPose(pose)
    },
    receiveNavigationPose: (pose) => {
      if (
        !active ||
        pose?.source !== '2d' ||
        pose.revision === lastAppliedNavigationRevision ||
        pose.revision === pendingNavigationPose?.revision
      ) {
        return
      }

      pendingNavigationPose = pose
      applyPendingNavigationPose()
    },
    setActive: (nextActive) => {
      if (active === nextActive) return
      active = nextActive
      if (!active) {
        pendingNavigationPose = null
        return
      }
      if (latestCameraPose) publishCameraNavigationPose(latestCameraPose)
    },
  }
}

export function useFloorplanCameraSyncBridge() {
  // The compass is portalled into the always-visible viewer area, so its
  // orientation-only 2D pose must still reach the camera while the floorplan
  // itself is hidden in 3D view.
  const bridgeRef = useRef<FloorplanCameraSyncBridge | null>(null)
  if (!bridgeRef.current) {
    bridgeRef.current = createFloorplanCameraSyncBridge({
      applyCameraPose: (pose) => emitter.emit('camera-controls:apply-pose', pose),
      publishNavigationPose: (pose) => liveCameraNavigation.publish(pose),
    })
  }
  const bridge = bridgeRef.current

  useEffect(() => subscribeCameraPose(bridge.receiveCameraPose), [bridge])

  useEffect(() => subscribeNavigationSyncPose(bridge.receiveNavigationPose), [bridge])
}
