# Equipment Plugin Migration Baseline

This baseline locks the before/after behavior for migrating factory equipment
generation from ad hoc primitive assemblies to plugin-owned equipment nodes.

## Scope

Phase 0 captures repeatable inputs and acceptance checks. It does not require
the new factory equipment plugin to exist yet.

Phase 1 introduces pure core contracts only:

- equipment contracts and ports
- industry pack manifests with equipment bindings
- node-definition metadata for equipment nodes
- tests for normalization and binding-to-spec resolution

No editor UI, viewer rendering, or AI orchestration should depend on Phase 1.

## Baseline Cases

### B1 Centrifugal Pump

Input intent:

```json
{
  "industry": "chemical",
  "equipment": "centrifugal pump",
  "params": {
    "pumpType": "centrifugal",
    "flowRate": 120,
    "motorPower": 15,
    "inletDiameter": 0.15,
    "outletDiameter": 0.1,
    "skidMounted": true
  }
}
```

Current expected behavior:

- generated as a multi-primitive assembly
- recognizable pump silhouette is desirable but not guaranteed
- inlet/outlet are visual or metadata hints, not first-class node ports
- inspector edits mostly target primitive dimensions, not equipment-level intent

Migration expected behavior:

- generated as one `factory:pump` node
- renderer owns pump body, motor, skid, flanges, and connection markers
- node exposes `inlet` and `outlet` ports from a pure contract
- inspector edits equipment parameters directly
- floor plan footprint reflects envelope dimensions and port direction

### B2 Pump Line Segment

Input intent:

```json
{
  "industry": "chemical",
  "stations": [
    { "id": "feed_tank", "equipment": "feed tank" },
    { "id": "transfer_pump", "equipment": "centrifugal pump" },
    { "id": "filter", "equipment": "cartridge filter" }
  ],
  "connections": [
    { "from": "feed_tank.outlet", "to": "transfer_pump.inlet", "medium": "water" },
    { "from": "transfer_pump.outlet", "to": "filter.inlet", "medium": "water" }
  ]
}
```

Current expected behavior:

- resolver may choose catalog, native tank, profile parts, or primitive fallback
- routing is inferred around generated shapes
- station geometry can vary between runs

Migration expected behavior:

- profile contracts select equipment node kinds before geometry is generated
- routing snaps to declared equipment ports
- unknown equipment can still fall back to primitive assembly
- station identity remains stable when the user changes equipment parameters

### B3 Unknown Custom Skid

Input intent:

```json
{
  "industry": "generic",
  "equipment": "custom dosing skid with two vessels and a metering pump",
  "params": {
    "skidMounted": true
  }
}
```

Current expected behavior:

- generated as primitives using profile or prompt-derived parts
- result quality depends heavily on prompt interpretation

Migration expected behavior:

- use an explicit fallback path when no equipment binding exists
- preserve the generated assembly under a stable container or assembly node
- emit a contract gap so pack authors can add a future binding

## Verification Matrix

| Claim | Current baseline | Migration acceptance |
| --- | --- | --- |
| Stable equipment identity | Primitive assembly may change shape and child count | One device-level node kind per bound equipment profile |
| Port semantics | Optional visual markers or metadata | Ports come from `EquipmentContract` / `NodeDefinition.ports` |
| Inspector edits | Primitive dimensions and material fields | Equipment-level schema drives user edits |
| Floor plan | Generic footprint from primitive bounds | Envelope and port side drive footprint and connection orientation |
| AI generation | LLM composes geometry directly | LLM chooses profile and parameters for a constrained generator |
| Fallback | Primitive generation is the default path | Primitive generation is only unbound/custom fallback |

## Phase 1 Done Criteria

- `@pascal-app/core` exports equipment contracts from the package root.
- `@pascal-app/core/equipment` is an explicit package export.
- `NodeDefinition` can declare equipment metadata and port resolution without
  importing editor, viewer, or Three.js code.
- Tests prove contract normalization, invalid input rejection, manifest binding
  normalization, and binding-to-spec parameter resolution.
