import {
  type AnyNodeId,
  openElevatorDoor,
  requestElevatorLevel,
  resolveElevatorDispatchTarget,
  useInteractive,
  useScene,
} from '@pascal-app/core'
import { useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { Mesh, type Object3D, Raycaster, Vector2 } from 'three'

type ElevatorButtonAction = 'open-door' | 'request-level'

type ElevatorButtonUserData = {
  action: ElevatorButtonAction
  disabled: boolean
  elevatorId: AnyNodeId
  kind: 'cab' | 'landing'
  levelId?: AnyNodeId
}

function getElevatorButtonData(object: Object3D): ElevatorButtonUserData | null {
  let current: Object3D | null = object

  while (current) {
    const data = (current.userData as { elevatorButton?: ElevatorButtonUserData }).elevatorButton
    if (data) return data
    current = current.parent
  }

  return null
}

/**
 * The roots of every elevator button under `object`. Any button along the ray
 * takes the click, so only they are raycast — never the rest of the scene,
 * whose meshes this capture-phase listener must not trip over.
 */
export function collectElevatorButtons(object: Object3D, into: Object3D[] = []): Object3D[] {
  if (!object.visible) return into
  if ((object.userData as { elevatorButton?: unknown }).elevatorButton) {
    into.push(object)
    return into
  }
  for (const child of object.children) collectElevatorButtons(child, into)
  return into
}

/** Ignore malformed material groups during transient paint updates, rather than raycasting invalid faces. */
export function pickElevatorButton(
  scene: Object3D,
  raycaster: Raycaster,
): ElevatorButtonUserData | null {
  const buttons = collectElevatorButtons(scene)
  const faces: Object3D[] = []
  for (const button of buttons)
    button.traverseVisible((object) => {
      if (object instanceof Mesh) faces.push(object)
    })
  const hit = raycaster.intersectObjects(faces, false)[0]
  if (!hit) return null
  const blockers: Mesh[] = []
  scene.traverseVisible((object) => {
    if (
      !(object instanceof Mesh) ||
      getElevatorButtonData(object) ||
      object.userData.pascalExport === 'strip'
    )
      return
    if (
      Array.isArray(object.material) &&
      object.geometry.groups.some(
        (group: { materialIndex?: number; count: number }) =>
          !object.material[group.materialIndex ?? 0] || !Number.isFinite(group.count),
      )
    )
      return
    blockers.push(object)
  })
  const occluded = raycaster.intersectObjects(blockers, false).some((intersection) => {
    if (intersection.distance >= hit.distance - 0.001) return false
    const mesh = intersection.object as Mesh
    const material = Array.isArray(mesh.material)
      ? mesh.material[intersection.face?.materialIndex ?? 0]
      : mesh.material
    return material?.visible && (!material.transparent || material.opacity >= 0.95)
  })
  return occluded ? null : getElevatorButtonData(hit.object)
}

export function ElevatorInteractionSystem({ enabled = true }: { enabled?: boolean }) {
  const camera = useThree((state) => state.camera)
  const gl = useThree((state) => state.gl)
  const scene = useThree((state) => state.scene)
  const raycasterRef = useRef(new Raycaster())
  const pointerRef = useRef(new Vector2())

  useEffect(() => {
    const canvas = gl.domElement

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || !enabled) return

      const buttons = collectElevatorButtons(scene)
      if (buttons.length === 0) return

      const rect = canvas.getBoundingClientRect()
      const pointer = pointerRef.current
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1

      const raycaster = raycasterRef.current
      raycaster.setFromCamera(pointer, camera)

      const button = pickElevatorButton(scene, raycaster)

      if (!button || button.disabled) return

      event.preventDefault()
      event.stopPropagation()

      if (button.action === 'open-door') {
        openElevatorDoor(button.elevatorId)
        return
      }

      if (!button.levelId) return

      const targetElevatorId =
        button.kind === 'landing'
          ? resolveElevatorDispatchTarget({
              elevators: useInteractive.getState().elevators,
              levelId: button.levelId,
              nodes: useScene.getState().nodes,
              requestedElevatorId: button.elevatorId,
            })
          : button.elevatorId

      requestElevatorLevel(targetElevatorId, button.levelId)
    }

    canvas.addEventListener('pointerdown', handlePointerDown, true)
    return () => {
      canvas.removeEventListener('pointerdown', handlePointerDown, true)
    }
  }, [camera, gl, scene, enabled])

  return null
}
