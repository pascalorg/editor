import type {
  ReferenceDeclaration,
  ReferenceDeletePolicy,
  ReferenceNamespace,
  ReferencePresetPolicy,
  ReferenceRole,
} from '../registry/types'

/**
 * How today's code reads an inventoried reference: a plain `path`, a
 * `prefixed` value (`prefix` + id), or `linked-by`, a derived, unpersisted
 * relation computed by `relations.linkedBy`.
 */
export type ReferenceExtractor = 'path' | 'prefixed' | 'linked-by'

/** Hand-written remap or cleanup sites that handle a reference today, which P-03 replaces. */
export type ReferenceRemapSite =
  | 'clone-scene-graph'
  | 'clone-level-subtree'
  | 'clone-nodes-into'
  | 'scene-clipboard'
  | 'level-duplication'
  | 'wall-merge'
  | 'wall-split'
  | 'wall-topology'
  | 'delete-nodes'

/**
 * One row of the existing-reference inventory (A-02): a declaration plus
 * how today's code handles it. `kind` is a node kind, `*` for every kind whose
 * schema has `path`, or `#scene` for scene-root records (`rootNodeIds`,
 * `collections`). Derived `linked-by` rows use the path `#linkedBy`.
 */
export type ExistingReference = ReferenceDeclaration & {
  kind: string
  extractor: ReferenceExtractor
  /** `linked-by` rows: the derivation rule. */
  linkedBy?: 'endpoint-match' | 'polygon-share'
  remaps: readonly ReferenceRemapSite[]
  note?: string
}

/**
 * The existing-reference inventory (A-02, R3 "existing references first").
 *
 * Every reference today's built-in node schemas and scene-root records persist,
 * with the policy P-03's one extractor must apply and the hand-written sites
 * that handle it now. `remaps` is what the code does today, including its
 * gaps: an empty list on a `node` reference means clone, delete and wall
 * topology all leave it pointing at the old id. `contracts/fidelity.test.ts`
 * checks the table against the schema AST (`discoverReferenceCandidates`),
 * the metadata tables against every editor source (`discoverMetadataKeys`),
 * and the clone columns against the three clone passes.
 * The private benchmark copy with source locations
 * (`bench/next-house/design/existing-references.json`) is generated from it.
 *
 * Not exported from the package: consumed by tests, P-03 and the generator.
 */

type Row = Omit<ExistingReference, 'extractor' | 'remaps'> & {
  extractor?: ExistingReference['extractor']
  remaps?: readonly ReferenceRemapSite[]
}

const row = (r: Row): ExistingReference => ({ extractor: 'path', remaps: [], ...r })

const policy = (
  namespace: ReferenceNamespace,
  role: ReferenceRole,
  onDelete: ReferenceDeletePolicy,
  onPreset: ReferencePresetPolicy,
) => ({ namespace, role, onDelete, onPreset })

const CLONES: readonly ReferenceRemapSite[] = ['clone-scene-graph', 'clone-level-subtree']
const WALL_TOPOLOGY: readonly ReferenceRemapSite[] = ['wall-merge', 'wall-split', 'wall-topology']

/** Inline `MaterialSchema` fields; each carries a texture URL and a sibling `<field>Preset`. */
const MATERIAL_FIELDS = [
  'material',
  'edgeMaterial',
  'exteriorMaterial',
  'glassMaterial',
  'interiorMaterial',
  'panelMaterial',
  'railingMaterial',
  'sideMaterial',
  'topMaterial',
  'treadMaterial',
  'wallMaterial',
] as const

const materialRows = MATERIAL_FIELDS.flatMap((field) => [
  row({
    kind: '*',
    path: `${field}.texture.url`,
    ...policy('asset', 'content', 'freeze', 'keep'),
    note: 'Texture by URL; a dangling URL renders the untextured material.',
  }),
  row({
    kind: '*',
    path: `${field}Preset`,
    ...policy('material', 'content', 'freeze', 'keep'),
    note: 'Library material preset name.',
  }),
])

const measurementAnchorRows = (
  kind: string,
  prefix: string,
  remaps: readonly ReferenceRemapSite[],
) => [
  row({
    kind,
    path: `${prefix}.reference.nodeId`,
    ...policy('node', 'host', 'freeze', 'materialize'),
    remaps,
    note: 'Feature anchor; `fallback` holds the materialized point that a freeze keeps.',
  }),
  row({
    kind,
    path: `${prefix}.reference.featureId`,
    ...policy('surface', 'host', 'freeze', 'materialize'),
    owner: `${prefix}.reference.nodeId`,
    note: 'Measurement feature (face, edge or point) of the anchored node; owner-scoped, survives clone.',
  }),
]

export const EXISTING_REFERENCES: readonly ExistingReference[] = [
  // ─── Hierarchy ────────────────────────────────────────────────────
  row({
    kind: '*',
    path: 'parentId',
    ...policy('node', 'hierarchy', 'cascade', 'strip'),
    remaps: [
      ...CLONES,
      'clone-nodes-into',
      'scene-clipboard',
      'level-duplication',
      ...WALL_TOPOLOGY,
    ],
  }),
  row({
    kind: '*',
    path: 'children[]',
    ...policy('node', 'hierarchy', 'drop', 'keep'),
    remaps: [
      ...CLONES,
      'clone-nodes-into',
      'scene-clipboard',
      'level-duplication',
      ...WALL_TOPOLOGY,
      'delete-nodes',
    ],
  }),
  row({
    kind: 'procedural-item',
    path: 'attachments.@key',
    ...policy('node', 'hierarchy', 'drop', 'keep'),
    remaps: ['clone-nodes-into'],
    note: 'Record key: a hosted child id. Only cloneNodesInto remaps it; the other clones keep the old key.',
  }),
  row({
    kind: 'procedural-item',
    path: 'attachments.*',
    ...policy('surface', 'internal', 'drop', 'keep'),
    note: 'Recipe surface of this item that the keyed child sits on.',
  }),
  row({
    kind: '#scene',
    path: 'rootNodeIds[]',
    ...policy('node', 'hierarchy', 'drop', 'keep'),
    remaps: ['clone-scene-graph', 'delete-nodes'],
  }),

  // ─── Hosts and supports ───────────────────────────────────────────
  row({
    kind: '*',
    path: 'wallId',
    ...policy('node', 'host', 'cascade', 'strip'),
    targetKinds: ['wall'],
    dependents: ['side', 'wallT'],
    remaps: [...CLONES, 'scene-clipboard', ...WALL_TOPOLOGY],
    note: 'Items, procedural items, doors and windows hosted as wall children.',
  }),
  row({
    kind: '*',
    path: 'roofSegmentId',
    ...policy('node', 'host', 'cascade', 'strip'),
    targetKinds: ['roof-segment'],
    dependents: ['roofFace', 'side'],
    remaps: CLONES,
    note: 'Roof accessories, and doors/windows/items on a segment wall face.',
  }),
  row({
    kind: 'window',
    path: 'dormerId',
    ...policy('node', 'host', 'cascade', 'strip'),
    targetKinds: ['dormer'],
    dependents: ['dormerFace'],

    note: 'Clone remaps the window `parentId` but not `dormerId`.',
  }),
  row({
    kind: 'item',
    path: 'blockFaceId',
    ...policy('surface', 'host', 'cascade', 'strip'),
    owner: 'parentId',
    note: 'Block topology face id; owner-scoped, survives clone.',
  }),
  row({
    kind: '*',
    path: 'supportSlabId',
    ...policy('node', 'host', 'drop', 'strip'),
    targetKinds: ['slab'],
    sentinels: ['ground'],
    remaps: [...CLONES, 'delete-nodes'],
    note: "'ground' pins the node to the level base; deleting the slab strips the field.",
  }),
  row({
    kind: 'stair',
    path: 'deckSlabId',
    ...policy('node', 'host', 'drop', 'strip'),
    targetKinds: ['slab'],
    remaps: [...CLONES, 'delete-nodes'],
  }),
  row({
    kind: 'roof',
    path: 'support.roofSegmentId',
    ...policy('node', 'host', 'drop', 'strip'),
    targetKinds: ['roof-segment'],
    remaps: CLONES,
    note: "Only on the `support.kind: 'roof'` branch.",
  }),
  row({
    kind: 'lean-to-extension',
    path: 'hostRoofId',
    ...policy('node', 'host', 'drop', 'strip'),
    targetKinds: ['roof'],
    remaps: CLONES,
  }),
  row({
    kind: 'lean-to-extension',
    path: 'hostRoofSegmentId',
    ...policy('node', 'host', 'drop', 'strip'),
    targetKinds: ['roof-segment'],
    dependents: ['hostRoofEdge', 'hostRoofEdgeRange', 'hostKind', 'hostHeightOffset'],
    remaps: CLONES,
  }),
  row({
    kind: 'lean-to-extension',
    path: 'hostSlabId',
    ...policy('node', 'host', 'drop', 'strip'),
    targetKinds: ['slab'],
    dependents: ['hostSlabEdgeIndex', 'hostSlabEdgeT', 'hostKind', 'hostHeightOffset'],
  }),
  row({
    kind: '*',
    path: 'wallAttachment.wallId',
    ...policy('node', 'host', 'freeze', 'strip'),
    targetKinds: ['wall'],
    dependents: [
      'wallAttachment.side',
      'wallAttachment.startUV',
      'wallAttachment.endUV',
      'wallAttachment.offset',
    ],
    note: 'Duct and pipe runs drafted on a wall; the level-local path is the frozen pose.',
  }),
  row({
    kind: '*',
    path: 'hangerOverrides.*.hostId',
    ...policy('node', 'host', 'drop', 'strip'),
    targetKinds: ['wall', 'ceiling'],
    note: 'Pinned hanger host; absent re-elects the nearest wall or ceiling.',
  }),
  row({
    kind: 'downspout',
    path: 'gutterId',
    ...policy('node', 'host', 'drop', 'strip'),
    targetKinds: ['gutter'],
  }),
  row({
    kind: 'downspout',
    path: 'outletId',
    ...policy('part', 'host', 'drop', 'strip'),
    owner: 'gutterId',
    note: "An entry of the gutter's `outlets[]`; owner-scoped, survives clone.",
  }),

  // ─── Parts and topology owned by the node ─────────────────────────
  row({
    kind: '*',
    path: 'hangerOverrides.@key',
    ...policy('part', 'internal', 'drop', 'keep'),
    note: 'Hanger slot `<leg>:<index>`: an index key, not a lattice key (F3 replaces it).',
  }),
  row({
    kind: 'block',
    path: 'topology.edges[].vertexIds[]',
    ...policy('part', 'internal', 'cascade', 'keep'),
  }),
  row({
    kind: 'block',
    path: 'topology.faces[].vertexIds[]',
    ...policy('part', 'internal', 'cascade', 'keep'),
  }),

  // ─── Connections (explicit and derived) ───────────────────────────
  // Shed joints are equality labels, not node references (B3). The lean-to
  // assembly writes lean-to ids (`assembly.ts`); the bench roof-fit converter
  // writes a source face id as both owner and sole neighbour, scoping a precut
  // facet to itself. The roof system only compares them for equality.
  row({
    kind: 'roof-segment',
    path: 'shedJointOwnerId',
    ...policy('label', 'connection', 'drop', 'strip'),
    note: 'Join label of this segment: a lean-to id or a source face id. Never resolved.',
  }),
  row({
    kind: 'roof-segment',
    path: 'shedJointNeighborIds[]',
    ...policy('label', 'connection', 'drop', 'strip'),
    note: 'Owner labels this segment may miter against; empty = any sibling.',
  }),
  row({
    kind: 'wall',
    path: '#linkedBy',
    ...policy('node', 'connection', 'drop', 'strip'),
    extractor: 'linked-by',
    linkedBy: 'endpoint-match',
    targetKinds: ['wall'],
    note: 'Wall junctions: derived from coincident endpoints, never persisted; the reverse index must carry them.',
  }),
  row({
    kind: 'fence',
    path: '#linkedBy',
    ...policy('node', 'connection', 'drop', 'strip'),
    extractor: 'linked-by',
    linkedBy: 'endpoint-match',
    targetKinds: ['fence'],
  }),

  // ─── Membership ───────────────────────────────────────────────────
  row({
    kind: 'zone',
    path: 'boundaryWallIds[]',
    ...policy('node', 'membership', 'drop', 'strip'),
    targetKinds: ['wall'],
    remaps: WALL_TOPOLOGY,
    note: 'Clone copies the old wall ids into the cloned zone.',
  }),
  row({
    kind: 'unit',
    path: 'members[]',
    ...policy('node', 'membership', 'drop', 'strip'),
    targetKinds: ['zone'],
    remaps: ['clone-scene-graph', 'level-duplication', 'delete-nodes'],
  }),
  row({
    kind: 'item',
    path: 'collectionIds[]',
    ...policy('collection', 'membership', 'drop', 'strip'),
    remaps: ['clone-scene-graph'],
  }),
  row({
    kind: '#scene',
    path: 'collections.*.nodeIds[]',
    ...policy('node', 'membership', 'drop', 'strip'),
    remaps: ['clone-scene-graph', 'delete-nodes'],
  }),
  ...(['fromLevelId', 'toLevelId'] as const).map((path) =>
    row({
      kind: 'stair',
      path,
      ...policy('node', 'membership', 'drop', 'strip'),
      targetKinds: ['level'],
      remaps: ['scene-clipboard'],
      note: 'Pasting a stair re-derives both from the target level.',
    }),
  ),
  ...(
    [
      'fromLevelId',
      'toLevelId',
      'defaultLevelId',
      'servedLevelIds[]',
      'disabledLevelIds[]',
      'serviceOnlyLevelIds[]',
    ] as const
  ).map((path) =>
    row({
      kind: 'elevator',
      path,
      ...policy('node', 'membership', 'drop', 'strip'),
      targetKinds: ['level'],
    }),
  ),
  row({
    kind: 'roof-segment',
    path: 'shedJointScopeId',
    ...policy('label', 'membership', 'drop', 'strip'),
    note: 'Scope label for comparing seams across roof parents; producers write a level id today.',
  }),

  // ─── Control ──────────────────────────────────────────────────────
  row({
    kind: '#scene',
    path: 'collections.*.controlNodeId',
    ...policy('node', 'control', 'drop', 'strip'),
    remaps: ['clone-scene-graph'],
    note: 'Node deletion leaves it dangling.',
  }),
  row({
    kind: 'construction-dimension',
    path: 'controllingDimensionId',
    ...policy('node', 'control', 'drop', 'strip'),
    targetKinds: ['construction-dimension'],
    remaps: [...CLONES, 'clone-nodes-into'],
  }),
  ...(['stairId', 'elevatorId'] as const).map((field) =>
    row({
      kind: '*',
      path: `holeMetadata[].${field}`,
      ...policy('node', 'control', 'drop', 'strip'),
      targetKinds: [field === 'stairId' ? 'stair' : 'elevator'],
      note: 'The cutter that owns this auto hole; its sync replaces only its own holes.',
    }),
  ),

  // ─── Measurements and dimensions ──────────────────────────────────
  ...measurementAnchorRows('measurement', 'measurement.points[]', [
    ...CLONES,
    'clone-nodes-into',
    'scene-clipboard',
  ]),
  ...measurementAnchorRows('measurement', 'measurement.base[]', [
    ...CLONES,
    'clone-nodes-into',
    'scene-clipboard',
  ]),
  ...measurementAnchorRows('construction-dimension', 'anchors[]', [...CLONES, 'clone-nodes-into']),

  // ─── Content: materials, assets, sources ──────────────────────────
  row({
    kind: '*',
    path: 'slots.*',
    ...policy('material', 'content', 'freeze', 'keep'),
    extractor: 'prefixed',
    prefix: 'scene:',
    remaps: ['scene-clipboard'],
    note: 'Scene palette entry; clone keeps material ids by design, paste mints new ones.',
  }),
  row({
    kind: '*',
    path: 'slots.*',
    ...policy('material', 'content', 'freeze', 'keep'),
    extractor: 'prefixed',
    prefix: 'library:',
    note: 'Library material; `#rrggbb` values are literal colours.',
  }),
  ...materialRows,
  ...(['asset.id', 'asset.src', 'asset.thumbnail', 'asset.floorPlanUrl'] as const).map((path) =>
    row({
      kind: 'item',
      path,
      ...policy('asset', 'content', 'freeze', 'keep'),
      note: 'Inline catalog asset (about 1 KB per item); F8 moves it to an asset reference.',
    }),
  ),
  ...(['scan', 'guide'] as const).map((kind) =>
    row({ kind, path: 'url', ...policy('asset', 'content', 'freeze', 'keep') }),
  ),
  row({
    kind: 'scan',
    path: 'captureSession.manifestUrl',
    ...policy('asset', 'content', 'freeze', 'keep'),
  }),
  ...(['captureSession.sessionId', 'captureSession.revisionId'] as const).map((path) =>
    row({
      kind: 'scan',
      path,
      ...policy('source', 'content', 'freeze', 'keep'),
      note: 'Capture provenance: stable across re-capture (R9).',
    }),
  ),
]

/** Candidate paths that are not references, with the reason. `kind: '*'` matches every kind. */
export const NON_REFERENCES: readonly { kind: string; path: string; reason: string }[] = [
  { kind: '*', path: 'id', reason: "The node's own id: a definition, not a reference." },
  {
    kind: '*',
    path: 'metadata.@key',
    reason: 'Open record: its keys are discovered from source and classified in METADATA_*.',
  },
  { kind: '*', path: 'metadata.*', reason: 'See metadata.@key.' },
  { kind: '*', path: 'slots.@key', reason: 'Slot id declared by the kind or its asset.' },
  { kind: 'block', path: 'slotNames.@key', reason: 'Slot id declared by the block.' },
  { kind: 'block', path: 'slotNames.*', reason: 'Display name.' },
  ...MATERIAL_FIELDS.map((field) => ({
    kind: '*',
    path: `${field}.id`,
    reason: 'Optional label of an inline material; no reader dereferences it.',
  })),
  { kind: 'block', path: 'topology.vertices[].id', reason: 'Defines a topology key.' },
  { kind: 'block', path: 'topology.edges[].id', reason: 'Defines a topology key.' },
  { kind: 'block', path: 'topology.faces[].id', reason: 'Defines a topology key.' },
  {
    kind: 'gutter',
    path: 'outlets[].id',
    reason: 'Defines an outlet key (see downspout.outletId).',
  },
  { kind: '*', path: 'stack[].id', reason: 'Defines a cabinet compartment key.' },
  {
    kind: 'procedural-item',
    path: 'recipe',
    reason: 'Inline versioned recipe (R7 stores recipes above 24 KiB by hash).',
  },
  { kind: 'procedural-item', path: 'parameters.@key', reason: 'Recipe parameter name.' },
  { kind: 'scan', path: 'layers.@key', reason: 'Layer visibility flag name.' },
  { kind: 'site', path: 'frontEdge', reason: "Index of the lot polygon's street-facing edge." },
  ...[
    'boundaries',
    'codeBasis',
    'elevation',
    'flood',
    'parcel',
    'soils',
    'structures',
    'utilities',
    'wetlands',
    'zoning',
  ].flatMap((section) => [
    { kind: 'site', path: `dossier.${section}.@key`, reason: 'Pascal Map dossier fact name.' },
    { kind: 'site', path: `dossier.${section}.*`, reason: 'Pascal Map dossier fact value.' },
  ]),
  { kind: 'site', path: 'dossier.sections.@key', reason: 'Pascal Map dossier section name.' },
  { kind: 'roof-segment', path: 'fasciaHighEdge', reason: 'Flag for the shed high-edge board.' },
  ...(['measurement.points[]', 'measurement.base[]', 'anchors[]'] as const).flatMap((prefix) => [
    { kind: '*', path: `${prefix}.reference.parameters.@key`, reason: 'Feature parameter name.' },
    { kind: '*', path: `${prefix}.reference.parameters.*`, reason: 'Feature parameter value.' },
  ]),
]

// ─── metadata.* ───────────────────────────────────────────────────────────
//
// `metadata` is an open record in the schema, so its references are found in
// the code that reads and writes it (`discoverMetadataKeys` over every editor
// source; the private generator does the same for importers). A discovered
// key matches a row path without its `metadata.` prefix and `[]` segments,
// and a key is also covered by any row beneath it (the scanner cannot see
// record values or array elements).

const meta = (path: string, r: Omit<Row, 'kind' | 'path'>) =>
  row({ kind: '*', path: `metadata.${path}`, ...r })

export const METADATA_REFERENCES: readonly ExistingReference[] = [
  meta('managedByLeanTo', {
    ...policy('node', 'internal', 'cascade', 'strip'),
    targetKinds: ['lean-to-extension'],
    note: 'The lean-to that generated this roof, segment, column or gutter.',
  }),
  meta('nodeSelectionProxyId', {
    ...policy('node', 'control', 'drop', 'strip'),
    note: 'Selecting this node selects the proxy instead (lean-to parts, cabinet runs).',
  }),
  ...(['leanToCornerJoints', 'leanToFreestandingCanopyJoints'] as const).map((key) =>
    meta(`${key}.*.neighborId`, {
      ...policy('node', 'connection', 'drop', 'strip'),
      targetKinds: ['lean-to-extension'],
      note: 'Joined neighbour lean-to per side.',
    }),
  ),
  meta('automaticRunEndCapOwnerId', {
    ...policy('node', 'internal', 'cascade', 'strip'),
    targetKinds: ['duct-segment', 'pipe-segment'],
    dependents: ['metadata.automaticRunEndCapEndpoint'],
    note: 'The run whose open end this automatic cap closes.',
  }),
  meta('conicalSourceWallId', {
    ...policy('node', 'internal', 'drop', 'strip'),
    targetKinds: ['wall'],
    note: 'The wall a conical roof was generated from.',
  }),
  meta('cabinetCornerDerivedRun.sourceRunId', {
    ...policy('node', 'internal', 'drop', 'strip'),
    targetKinds: ['cabinet'],
    dependents: [
      'metadata.cabinetCornerDerivedRun.side',
      'metadata.cabinetCornerDerivedRun.turnSide',
      'metadata.cabinetCornerDerivedRun.role',
    ],
  }),
  meta('cabinetCornerDerivedRun.sourceModuleId', {
    ...policy('node', 'internal', 'drop', 'strip'),
    targetKinds: ['cabinet-module'],
  }),
  meta('cabinetCornerSourceLink.linkedRunIds[]', {
    ...policy('node', 'connection', 'drop', 'strip'),
    targetKinds: ['cabinet'],
    dependents: ['metadata.cabinetCornerSourceLink.side'],
    note: 'Deleting the last linked run drops the link (run-ops).',
  }),
  meta('cabinetPresetWidthDebtBySource.@key', {
    ...policy('node', 'internal', 'drop', 'strip'),
    targetKinds: ['cabinet-module'],
    note: 'Record keyed by the source module id.',
  }),
  meta('partnerIds[]', {
    ...policy('node', 'connection', 'drop', 'strip'),
    dependents: ['metadata.altJoint'],
    note: 'Fitting partners of an alternate joint.',
  }),
  meta('autoOffset.minted[]', {
    ...policy('node', 'internal', 'drop', 'strip'),
    note: 'Elbows and risers minted by an automatic offset; deleted on rewind.',
  }),
  meta('autoOffset.base[].id', {
    ...policy('node', 'internal', 'drop', 'strip'),
    note: 'Restore patches for the run and its partners.',
  }),
  meta('autoOffset.group', {
    ...policy('label', 'internal', 'drop', 'strip'),
    note: 'Offset group label.',
  }),
  ...(['referenceLevelId', 'roofLevelId'] as const).map((key) =>
    meta(key, {
      ...policy('node', 'membership', 'drop', 'strip'),
      targetKinds: ['level'],
      note: 'Written by the MCP roof tools on roof levels and roofs.',
    }),
  ),
  meta('floorPlanUrl', { ...policy('asset', 'content', 'freeze', 'keep') }),
  ...(
    ['expressID', 'globalId', 'hostWallExpressID', 'ifcSimplification.mergedExpressIDs[]'] as const
  ).map((key) =>
    meta(key, {
      ...policy('source', 'content', 'freeze', 'keep'),
      note: 'IFC provenance written by the IFC converter.',
    }),
  ),
]

const described = (reason: string, paths: readonly string[]) =>
  paths.map((path) => ({ path, reason }))

/** Metadata keys found in editor sources that are not references. */
export const METADATA_NON_REFERENCES: readonly { path: string; reason: string }[] = [
  ...described('Flag, enum, number or tag; names nothing.', [
    'annotationObstacle',
    'annotationRole',
    'autoGutter',
    'autoGutterSide',
    'autoRidgeVent',
    'cabinetAdjacencyRevision',
    'cabinetLayoutRevision',
    'cabinetPresetNominalWidth',
    'deferParentRebuild',
    'drawingCoordinationLocked',
    'floor',
    'footprintApproximated',
    'generatedBy',
    'isFloorplanPreview',
    'isNew',
    'isTransient',
    'leanToDrainageSide',
    'leanToGutterArcStraightEnds',
    'leanToGutterEaveY',
    'leanToGutterMitres',
    'leanToPostIndex',
    'leanToPostSide',
    'leanToRole',
    'leanToRoofPlane',
    'locked',
    'openingManaged',
    'placementAdjusted',
    'porch',
    'renderPass',
    'role',
    'showTrimPlanes',
    'storyShell',
    'suppressedDimensionSegmentIndexes',
  ]),
  ...described('Read as a truthy flag only; no editor writer.', ['arrayModifier', 'linkedArray']),
  ...described('Display or authoring label written by the MCP tools.', [
    'label',
    'name',
    'roomName',
    'roomType',
    'mcpTool',
    'edgeIndex',
  ]),
  ...described('IFC attribute copy: a value or IFC label, not an id.', [
    'elevation',
    'height',
    'thickness',
    'sillHeight',
    'polygon',
    'material',
    'materialLayers',
    'ifcName',
    'ifcType',
    'objectType',
    'predefinedType',
    'operationType',
    'ifcSimplification.mergedWallCount',
  ]),
  ...described('MCP template descriptor metadata, not scene-node metadata.', ['id', 'description']),
  ...described(
    'A `holeMetadata` entry held in a local named `metadata`; inventoried as holeMetadata[].',
    ['stairId', 'elevatorId', 'source', 'metadata'],
  ),
  ...described('Print-export artifact metadata, not scene-node metadata.', ['status']),
  ...described('Derived floorplan drawing metadata, not scene-node metadata.', [
    'at',
    'buildingId',
    'levelM',
    'side',
    'sitePlan',
    'textSizePt',
  ]),
  ...described('Site-plan facts kept on the node: values, not ids.', [
    'flatworkDims',
    'services',
    'streetNames',
    'terrainSample',
  ]),
  ...described('Registry extension key, not scene-node metadata.', ['pascal:editor/floorplan']),
  ...described('Next.js page metadata export, not scene-node metadata.', ['title']),
]

const bare = (path: string) => path.replace(/^metadata\./, '').replace(/\[\]/g, '')

/**
 * Whether a discovered metadata key is classified: a row at that path, a
 * dependent of a row, or a row beneath it.
 */
export function metadataKeyClassified(
  key: string,
  references: readonly ReferenceDeclaration[],
  nonReferences: readonly { path: string }[],
): boolean {
  const paths = references.flatMap((r) => [r.path, ...(r.dependents ?? [])]).map(bare)
  return (
    paths.some((p) => p === key || p.startsWith(`${key}.`)) ||
    nonReferences.some((r) => bare(r.path) === key)
  )
}
