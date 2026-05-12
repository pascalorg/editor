import { useFrame } from '@react-three/fiber'
import { stepElevatorRuntimes } from './elevator-runtime'

export function ElevatorRuntimeSystem() {
  useFrame(({ clock }, delta) => {
    stepElevatorRuntimes(clock.getElapsedTime() * 1000, delta)
  }, 2)

  return null
}
