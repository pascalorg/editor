/**
 * Re-exports from React Three Fiber ecosystem.
 * Import from here to ensure a single instance across all packages.
 */

// @react-spring/three
export { animated, useSpring } from '@react-spring/three'
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
export type { ThreeElements } from '@react-three/fiber'
// @react-three/fiber
export { Canvas, useFrame, useThree } from '@react-three/fiber'

// Re-export zustand shallow for convenience
export { useShallow } from 'zustand/react/shallow'
