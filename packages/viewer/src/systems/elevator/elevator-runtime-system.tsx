import { stepElevatorRuntimes } from '@pascal-app/core'
import { useFrame } from '@react-three/fiber'

export function ElevatorRuntimeSystem() {
  useFrame(({ clock }, delta) => {
    stepElevatorRuntimes(clock.getElapsedTime() * 1000, delta)
  }, 2)

  return null
}
