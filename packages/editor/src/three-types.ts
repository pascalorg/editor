import type { ThreeElements } from '@react-three/fiber'
import '@react-three/fiber'

interface PascalEditorThreeElements {
  lineBasicNodeMaterial: any
}

declare global {
  namespace JSX {
    interface IntrinsicElements extends ThreeElements, PascalEditorThreeElements {}
  }
}

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements extends ThreeElements, PascalEditorThreeElements {}
  }
}
