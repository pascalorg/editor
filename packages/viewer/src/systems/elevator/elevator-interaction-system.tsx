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
import { type Object3D, Raycaster, Vector2 } from 'three'

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

export function ElevatorInteractionSystem() {
  const camera = useThree((state) => state.camera)
  const gl = useThree((state) => state.gl)
  const scene = useThree((state) => state.scene)
  const raycasterRef = useRef(new Raycaster())
  const pointerRef = useRef(new Vector2())

  useEffect(() => {
    const canvas = gl.domElement

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return

      const rect = canvas.getBoundingClientRect()
      const pointer = pointerRef.current
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1

      const raycaster = raycasterRef.current
      raycaster.setFromCamera(pointer, camera)

      const button = raycaster
        .intersectObjects(scene.children, true)
        .map((intersection) => getElevatorButtonData(intersection.object))
        .find((data): data is ElevatorButtonUserData => data !== null)

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
  }, [camera, gl, scene])

  return null
}
