import structuredClonePolyfill from '@ungap/structured-clone'

if (typeof globalThis.structuredClone !== 'function') {
  globalThis.structuredClone = structuredClonePolyfill
}
