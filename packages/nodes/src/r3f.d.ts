export {}

type PascalNodesElements = {
  lineBasicNodeMaterial: any
}

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements extends PascalNodesElements {}
  }
}

declare module 'react/jsx-runtime' {
  namespace JSX {
    interface IntrinsicElements extends PascalNodesElements {}
  }
}

declare module 'react/jsx-dev-runtime' {
  namespace JSX {
    interface IntrinsicElements extends PascalNodesElements {}
  }
}
