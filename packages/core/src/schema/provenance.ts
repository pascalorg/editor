import { z } from 'zod'

/**
 * Typed source identity of a node (owner decision D5): which source elements
 * it reproduces, and which nodes it was derived from by an edit.
 *
 * The field is `provenance`, not `source`: a hosted third-party plugin already
 * declares its own top-level `source` (`articraft:asset`), and `.extend()`
 * would silently replace the base field for that kind.
 *
 * Caps are fixed and never enforced by truncation. A node over a cap fails
 * its schema, so every validated writer (hosted save, collaboration, MCP)
 * refuses it with an issue at the capped path, while load keeps a stored node
 * verbatim. A writer with more ids than fit must refuse, or keep the extra ids
 * off the node (sub-record `src`, the import artifact's alias table).
 *
 * With ASCII ids a full value is at most about 12 KiB: half the 24 KiB F8
 * field cap and a fifth of a 64 KiB collaboration operation. Bulk writers
 * chunk their operations by encoded bytes.
 */

/** Refs per node. The /next house's largest node carries 18 source ids. */
export const PROVENANCE_MAX_REFS = 32
/** Node ids in one lineage record (the pieces of a merge). */
export const PROVENANCE_MAX_LINEAGE_IDS = 32
/** A namespace: `al` (a SketchUp source at a config hash), `ifc:<file>`, `cap:<capture>`. */
export const PROVENANCE_MAX_NAMESPACE_LENGTH = 48
/** A source id, stored verbatim (never slugged). The house's longest is 72. */
export const PROVENANCE_MAX_ID_LENGTH = 160
/** A node id, as the collaboration protocol bounds it. */
export const PROVENANCE_MAX_NODE_ID_LENGTH = 128

/**
 * How a ref claims its source element:
 * - `primary`: this node reproduces the element 1:1 (the default when absent);
 * - `piece`: one of several declared pieces across sibling nodes, scored on their union;
 * - `absorbed`: folded into this node without an address of its own (traceable, never exact);
 * - `alias`: a retired id that resolves to this node;
 * - `derived`: a copy or user variant; it never claims the element.
 */
export const ProvenanceRole = z.enum(['primary', 'piece', 'absorbed', 'alias', 'derived'])
export type ProvenanceRole = z.infer<typeof ProvenanceRole>

export const ProvenanceRef = z.object({
  ns: z.string().min(1).max(PROVENANCE_MAX_NAMESPACE_LENGTH).optional(),
  id: z.string().min(1).max(PROVENANCE_MAX_ID_LENGTH),
  role: ProvenanceRole.optional(),
})
export type ProvenanceRef = z.infer<typeof ProvenanceRef>

export const ProvenanceLineageOp = z.enum([
  'import',
  'split',
  'merge',
  'duplicate',
  'convert',
  'promote',
  'make-independent',
  'attach',
])
export type ProvenanceLineageOp = z.infer<typeof ProvenanceLineageOp>

/**
 * The last edit that derived this node, and the node ids it came from. The ids
 * are history: they are compared, never dereferenced, and may name nodes that
 * no longer exist (the other walls of a merge).
 */
export const ProvenanceLineage = z.object({
  op: ProvenanceLineageOp,
  fromIds: z
    .array(z.string().min(1).max(PROVENANCE_MAX_NODE_ID_LENGTH))
    .max(PROVENANCE_MAX_LINEAGE_IDS),
})
export type ProvenanceLineage = z.infer<typeof ProvenanceLineage>

export const Provenance = z.object({
  refs: z.array(ProvenanceRef).max(PROVENANCE_MAX_REFS),
  lineage: ProvenanceLineage.optional(),
})
export type Provenance = z.infer<typeof Provenance>
