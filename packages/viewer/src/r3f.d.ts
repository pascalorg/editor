// Augment @react-three/fiber's ThreeElements to include all Three.js JSX intrinsic elements.
// This must be a project-wide declaration so all files can use <directionalLight />, etc.
import type { ThreeToJSXElements } from '@react-three/fiber'
import * as THREE from 'three/webgpu'

declare module '@react-three/fiber' {
  interface ThreeElements extends ThreeToJSXElements<typeof THREE> {}
}
