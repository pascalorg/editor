export {}

type PascalPluginTreeElements = {
  boxGeometry: any
  group: any
  instancedMesh: any
  mesh: any
  meshBasicMaterial: any
  primitive: any
}

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements extends PascalPluginTreeElements {}
  }
}

declare module 'react/jsx-runtime' {
  namespace JSX {
    interface IntrinsicElements extends PascalPluginTreeElements {}
  }
}

declare module 'react/jsx-dev-runtime' {
  namespace JSX {
    interface IntrinsicElements extends PascalPluginTreeElements {}
  }
}
