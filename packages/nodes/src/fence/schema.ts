/**
 * Fence schema re-export.
 *
 * Lives in `@pascal-app/core` for now (same as wall + door + window +
 * spawn — the canonical schemas stay there until Phase 6 derives them
 * from the registry). The registry definition consumes it here so the
 * rest of the bundle imports a single canonical type.
 */
export { FenceNode } from '@pascal-app/core'
