import type { ThreeElement, ThreeElements } from '@react-three/fiber'
import { LineBasicNodeMaterial } from 'three/webgpu'

interface EditorThreeElements extends ThreeElements {
  lineBasicNodeMaterial: ThreeElement<typeof LineBasicNodeMaterial>
}

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements extends EditorThreeElements {}
  }
}

declare module 'react/jsx-runtime' {
  namespace JSX {
    interface IntrinsicElements extends EditorThreeElements {}
  }
}

declare module 'react/jsx-dev-runtime' {
  namespace JSX {
    interface IntrinsicElements extends EditorThreeElements {}
  }
}
