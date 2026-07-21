declare module '@ungap/structured-clone' {
  type StructuredCloneOptions = StructuredSerializeOptions & {
    json?: boolean
    lossy?: boolean
  }

  export default function structuredClone<T>(value: T, options?: StructuredCloneOptions): T
}
