// Shelf schema lives in core for now (referenced by the hand-maintained
// AnyNode union). Phase 6 derives AnyNode from the registry and the schema
// moves entirely into this package. Re-exporting here keeps all shelf-related
// imports inside @pascal-app/nodes/shelf — node bundle consumers don't need
// to know which side of the migration owns the file.

export { ShelfNode } from '@pascal-app/core'
