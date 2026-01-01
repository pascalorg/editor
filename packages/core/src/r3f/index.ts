/**
 * Re-exports from React Three Fiber ecosystem.
 * Import from here to ensure a single instance across all packages.
 */

// @react-three/fiber
export { Canvas, useFrame, useThree } from '@react-three/fiber'
export type { ThreeElements } from '@react-three/fiber'

// @react-three/drei
export {
  Bvh,
  CameraControls,
  CameraControlsImpl,
  Line,
  OrthographicCamera,
  PerspectiveCamera,
  SoftShadows,
} from '@react-three/drei'

// @react-spring/three
export { animated, useSpring } from '@react-spring/three'

// Re-export zustand shallow for convenience
export { useShallow } from 'zustand/react/shallow'
