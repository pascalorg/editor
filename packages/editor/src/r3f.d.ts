export {}

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      lineBasicNodeMaterial: any
    }
  }
}

declare module 'react/jsx-runtime' {
  namespace JSX {
    interface IntrinsicElements {
      lineBasicNodeMaterial: any
    }
  }
}

declare module 'react/jsx-dev-runtime' {
  namespace JSX {
    interface IntrinsicElements {
      lineBasicNodeMaterial: any
    }
  }
}
