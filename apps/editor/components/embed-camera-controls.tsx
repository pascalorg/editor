'use client'

import { type CameraControlFrameEvent, emitter, sceneRegistry, useScene } from '@pascal-app/core'
import { frameViewerCamera, useViewerCameraNavigationSync } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { CameraControls, CameraControlsImpl } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import {
  type BatchedMesh,
  Box3,
  type InstancedMesh,
  Matrix4,
  type Mesh,
  type Object3D,
  type PerspectiveCamera,
  Vector3,
} from 'three'

const { ACTION } = CameraControlsImpl

/**
 * The embed's orbit camera. With `selectable` (the Preview chrome) the left
 * button belongs to selection and hover, as in Preview: right rotates, middle or
 * Space + left pans. Without it nothing is selectable, so the left button rotates.
 *
 * It opens on the whole building once the scene is ready, not on the site's
 * saved view: that is the author's last editing angle, not a first impression.
 */
export function EmbedCameraControls({
  sceneReady,
  selectable = true,
}: {
  sceneReady: boolean
  selectable?: boolean
}) {
  const controls = useRef<CameraControlsImpl>(null!)
  const cameraMode = useViewer((s) => s.cameraMode)
  const walkthroughMode = useViewer((s) => s.walkthroughMode)
  const opened = useRef(false)
  const camera = useThree((state) => state.camera)
  const publishNavigationPose = useViewerCameraNavigationSync(controls)

  const wheel = cameraMode === 'orthographic' ? ACTION.ZOOM : ACTION.DOLLY
  const mouseButtons = useMemo(
    () => ({
      left: selectable ? ACTION.NONE : ACTION.ROTATE,
      middle: ACTION.SCREEN_PAN,
      right: selectable ? ACTION.ROTATE : ACTION.SCREEN_PAN,
      wheel,
    }),
    [selectable, wheel],
  )

  const touches = useMemo(
    () => ({
      one: ACTION.TOUCH_ROTATE,
      three: ACTION.TOUCH_ROTATE,
      two: cameraMode === 'orthographic' ? ACTION.TOUCH_ZOOM_TRUCK : ACTION.TOUCH_DOLLY_TRUCK,
    }),
    [cameraMode],
  )

  // A default pose until the scene is ready, then an instant cut to the fitted view.
  useEffect(() => {
    controls.current?.setLookAt(30, 30, 30, 0, 0, 0, false)
  }, [])

  useEffect(() => {
    const control = controls.current
    if (!control || !sceneReady || opened.current) return
    opened.current = true
    const objects = Object.values(useScene.getState().nodes)
      .filter((node) => node.type === 'building')
      .map((node) => sceneRegistry.nodes.get(node.id))
      .filter((object) => object !== undefined)
    const points = visiblePoints(objects)
    if (points.length === 0) return
    if ((camera as PerspectiveCamera).isPerspectiveCamera) {
      const pose = openingPose(points, camera as PerspectiveCamera)
      control.setLookAt(...pose.position, ...pose.target, false)
      return
    }
    const bounds = new Box3().setFromPoints(points)
    frameViewerCamera(control, camera, {
      bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() },
    })
  }, [sceneReady, camera])

  // The header's breadcrumb and floor list frame what they select.
  useEffect(() => {
    const onFrame = (event: CameraControlFrameEvent) => {
      const control = controls.current
      if (!control) return
      frameViewerCamera(control, camera, event)
    }
    emitter.on('camera-controls:frame', onFrame)
    return () => emitter.off('camera-controls:frame', onFrame)
  }, [camera])

  // The controls bar's top view and quarter turns.
  useEffect(() => {
    const quarterTurn = (direction: 1 | -1) => {
      const control = controls.current
      if (!control) return
      const rounded = Math.round(control.azimuthAngle / (Math.PI / 2)) * (Math.PI / 2)
      control.rotateTo(rounded + (direction * Math.PI) / 2, control.polarAngle, true)
    }
    const handleTopView = () => {
      const control = controls.current
      if (!control) return
      control.rotatePolarTo(control.polarAngle < 0.1 ? Math.PI / 4 : 0, true)
    }
    const handleOrbitCW = () => quarterTurn(-1)
    const handleOrbitCCW = () => quarterTurn(1)

    emitter.on('camera-controls:top-view', handleTopView)
    emitter.on('camera-controls:orbit-cw', handleOrbitCW)
    emitter.on('camera-controls:orbit-ccw', handleOrbitCCW)
    return () => {
      emitter.off('camera-controls:top-view', handleTopView)
      emitter.off('camera-controls:orbit-cw', handleOrbitCW)
      emitter.off('camera-controls:orbit-ccw', handleOrbitCCW)
    }
  }, [])

  // Space + left pans, as in the editor, while the left button otherwise selects.
  useEffect(() => {
    if (!selectable) return
    const setLeft = (space: boolean) => {
      if (!controls.current) return
      controls.current.mouseButtons.left = space ? ACTION.SCREEN_PAN : ACTION.NONE
      document.body.style.cursor = space ? 'grab' : ''
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Space') setLeft(true)
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') setLeft(false)
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('keyup', onKeyUp)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('keyup', onKeyUp)
      if (document.body.style.cursor === 'grab') document.body.style.cursor = ''
    }
  }, [selectable])

  const onTransitionStart = useCallback(() => {
    useViewer.getState().setCameraDragging(true)
  }, [])

  const onRest = useCallback(() => {
    useViewer.getState().setCameraDragging(false)
  }, [])

  if (walkthroughMode) return null

  return (
    <CameraControls
      makeDefault
      maxDistance={100}
      maxPolarAngle={Math.PI / 2 - 0.1}
      minDistance={5}
      minPolarAngle={0}
      mouseButtons={mouseButtons}
      onRest={onRest}
      onSleep={onRest}
      onTransitionStart={onTransitionStart}
      onUpdate={publishNavigationPose}
      ref={controls}
      restThreshold={0.01}
      touches={touches}
    />
  )
}

// A three-quarter view from above, the default editor heading.
const OPENING_DIRECTION = new Vector3(1, 1, 1).normalize()
const OPENING_PADDING = 1.08
const MAX_SAMPLES_PER_MESH = 4000

type Vec3 = [number, number, number]

/**
 * World-space points on every visible mesh. Merged batches and instance sets
 * span many items, so their boxes are as loose as the plan is diagonal: sample
 * vertices (at most `MAX_SAMPLES_PER_MESH` per mesh) and each instance's box.
 */
function visiblePoints(objects: Object3D[]): Vector3[] {
  const points: Vector3[] = []
  const box = new Box3()
  const instanceMatrix = new Matrix4()
  const pushBox = (matrix: Matrix4) => {
    for (let i = 0; i < 8; i++) {
      points.push(
        new Vector3(
          i & 1 ? box.max.x : box.min.x,
          i & 2 ? box.max.y : box.min.y,
          i & 4 ? box.max.z : box.min.z,
        ).applyMatrix4(matrix),
      )
    }
  }
  for (const root of objects) {
    root.updateWorldMatrix(true, true)
    root.traverseVisible((child) => {
      const mesh = child as Mesh
      if (!mesh.isMesh) return
      if ((mesh as InstancedMesh).isInstancedMesh) {
        const instanced = mesh as InstancedMesh
        if (!instanced.geometry.boundingBox) instanced.geometry.computeBoundingBox()
        if (!instanced.geometry.boundingBox) return
        box.copy(instanced.geometry.boundingBox)
        for (let i = 0; i < instanced.count; i++) {
          instanced.getMatrixAt(i, instanceMatrix)
          pushBox(instanceMatrix.premultiply(mesh.matrixWorld))
        }
        return
      }
      if ((mesh as BatchedMesh).isBatchedMesh) {
        const batched = mesh as BatchedMesh
        for (let i = 0; i < batched.instanceCount; i++) {
          try {
            if (!batched.getVisibleAt(i)) continue
            if (!batched.getBoundingBoxAt(batched.getGeometryIdAt(i), box)) continue
            batched.getMatrixAt(i, instanceMatrix)
          } catch {
            continue // A deleted instance.
          }
          pushBox(instanceMatrix.premultiply(mesh.matrixWorld))
        }
        return
      }
      const position = mesh.geometry.getAttribute('position')
      if (!position) return
      const step = Math.max(1, Math.ceil(position.count / MAX_SAMPLES_PER_MESH))
      for (let i = 0; i < position.count; i += step) {
        points.push(new Vector3().fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld))
      }
    })
  }
  return points
}

/**
 * The closest camera, along the opening direction, that keeps every point in
 * view, aimed so the points sit centred on screen rather than their box.
 */
function openingPose(
  points: Vector3[],
  camera: PerspectiveCamera,
): { position: Vec3; target: Vec3 } {
  const back = OPENING_DIRECTION
  const right = new Vector3(0, 1, 0).cross(back).normalize()
  const up = back.clone().cross(right)
  const tanV = Math.tan((camera.fov * Math.PI) / 360)
  const tanH = tanV * camera.aspect
  const center = new Box3().setFromPoints(points).getCenter(new Vector3())
  const offset = new Vector3()

  const fit = () => {
    let distance = 0
    for (const point of points) {
      offset.subVectors(point, center)
      const toward = offset.dot(back)
      distance = Math.max(
        distance,
        toward + Math.abs(offset.dot(right)) / tanH,
        toward + Math.abs(offset.dot(up)) / tanV,
      )
    }
    return distance
  }

  let distance = fit()
  for (let pass = 0; pass < 3; pass++) {
    let minX = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY
    for (const point of points) {
      offset.subVectors(point, center)
      const depth = Math.max(distance - offset.dot(back), 1e-3)
      const x = offset.dot(right) / (depth * tanH)
      const y = offset.dot(up) / (depth * tanV)
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)
    }
    center
      .addScaledVector(right, ((minX + maxX) / 2) * distance * tanH)
      .addScaledVector(up, ((minY + maxY) / 2) * distance * tanV)
    distance = fit()
  }

  const position = center.clone().addScaledVector(back, distance * OPENING_PADDING)
  return { position: position.toArray(), target: center.toArray() }
}
