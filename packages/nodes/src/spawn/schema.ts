// Spawn's Zod schema lives in core today (and remains in the hand-maintained
// AnyNode union until Phase 6 derives it from the registry). The registry
// definition references it via this re-export so all consumers in
// `@pascal-app/nodes` can import from one place.

export { SpawnNode } from '@pascal-app/core'
