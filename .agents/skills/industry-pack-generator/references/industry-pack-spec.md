# Industry Pack Scaffold Spec

Use this JSON shape as input to `apps/editor/scripts/scaffold-industry-profile-pack.ts`.

```json
{
  "industry": "cement",
  "id": "industry.cement.basic",
  "name": "Cement Basic Equipment Pack",
  "version": "0.1.0",
  "description": "Focused cement plant equipment pack.",
  "schemaVersion": "2.0",
  "dependsOnPlugins": ["pascal:factory-equipment"],
  "capabilities": ["factory_creation"],
  "factoryArchitectures": [
    {
      "id": "cement.factory.modular",
      "label": "Cement plant modular architecture",
      "industry": "cement",
      "processId": "cement_plant_full",
      "layoutStyle": "linear",
      "defaultDimensions": { "length": 60, "width": 24 },
      "modules": [
        {
          "id": "pyro_line",
          "displayLabel": "Pyro line",
          "order": 10,
          "stationIds": ["rotary_kiln"]
        }
      ]
    }
  ],
  "processTemplates": [
    {
      "processId": "cement_plant_full",
      "processLabel": "Cement plant",
      "processDisplayLabel": "Cement plant",
      "domain": "industrial",
      "aliases": ["cement plant", "cement factory"],
      "requiredRoles": ["rotary_kiln"],
      "defaultLayoutStyle": "linear",
      "defaultDimensions": { "length": 60, "width": 24 },
      "stations": [
        {
          "id": "rotary_kiln",
          "label": "Rotary kiln",
          "displayLabel": "Rotary kiln",
          "role": "rotary_kiln",
          "equipmentHint": "cement.rotary_kiln long inclined rotary kiln",
          "profileId": "cement.rotary_kiln",
          "footprintHint": "long"
        }
      ]
    }
  ],
  "devices": [
    {
      "id": "rotary_kiln",
      "name": "Rotary kiln",
      "aliases": ["rotary kiln", "cement kiln", "回转窑", "水泥回转窑"],
      "recipeId": "factory:storage-tank",
      "layoutFamily": "vessel_layout",
      "family": "tank",
      "defaultDimensions": { "length": 12, "width": 2.2, "height": 2.4 },
      "processPorts": [
        { "id": "inlet", "side": "left", "diameter": 0.3 },
        { "id": "outlet", "side": "right", "diameter": 0.28 }
      ],
      "equipmentDefaults": { "orientation": "horizontal", "capacity": 30, "liquidLevel": 0.35 },
      "primarySemanticRole": "kiln_shell",
      "parts": [
        {
          "kind": "cylindrical_tank",
          "semanticRole": "kiln_shell",
          "required": true,
          "length": 12,
          "radius": 0.65,
          "axis": "x"
        }
      ],
      "forbiddenRoles": ["vehicle_cabin"],
      "shapeCount": { "min": 8, "max": 80 },
      "visualCues": ["long inclined cylinder", "riding rings", "support rollers"]
    }
  ]
}
```

## Top-Level Fields

- `industry`: required. Use a focused industry id such as `cement`, `food`, `fine-chemical`, or `electrolytic-aluminum`.
- `id`: optional. Defaults to `industry.{industry}.basic`.
- `name`: optional. Defaults to `{industry} Basic Equipment Pack`.
- `version`: optional. Defaults to `0.1.0`.
- `schemaVersion`: optional. Defaults to `2.0`.
- `dependsOn`: optional for extension packs, for example `[{ "id": "industry.fine-chemical.basic", "version": ">=0.1.0" }]`.
- `dependsOnPlugins`: optional. Defaults to `["pascal:factory-equipment"]` for v2 equipment-node packs.
- `capabilities`: optional. Use `["factory_creation"]` only when the pack includes factory/process knowledge.
- `factoryArchitectures`: required when `capabilities` includes `factory_creation`; otherwise optional. Defines the whole-plant module tree.
- `processTemplates`: required when `capabilities` includes `factory_creation`; otherwise optional. Defines stations, aliases, and station connections.
- `devices`: required non-empty list.

## Factory-Capable Pack Rules

When `capabilities` includes `factory_creation`, QA enforces:

- At least one `factoryArchitectures` resource.
- At least one `processTemplates` resource.
- Every station must resolve through `profileId`/`equipmentProfileId` to an `equipmentBindings[]`
  entry or declare `genericFallback.reason`.
- Every process-template station must be covered by a device profile, native resolver, or catalog resolver hint.
- Every architecture module `stationIds[]` entry must exist in the matching process template.
- Factory creation is intentionally single-process-template per request. Do not add quantity expansion fields such as `parameters`, `flows`, `countParam`, `defaultCount`, `minCount`, `maxCount`, or `replicatedStationIds`.

If the pack only provides equipment profiles, omit `factory_creation`; QA will classify it as a `device-only` pack.

## Device Fields

- `id`, `name`, `aliases`, `parts`, `primarySemanticRole` are required.
- `layoutFamily` defaults to `generic_industrial_layout`.
- `family` defaults to `generic`.
- `recipeId` may reference a registered semantic equipment recipe such as `factory:centrifugal-pump`, `factory:storage-tank`, `factory:distillation-unit`, `factory:refinery-reactor-unit`, or `factory:refinery-auxiliary-unit`; otherwise the scaffold infers known equipment kinds from profile text.
- `defaultDimensions` should describe the whole equipment envelope.
- `processPorts` declares device-level ports that v2 `portMap` must cover.
- `equipmentDefaults` declares equipment-node parameters such as pump type, flow rate, motor power,
  tank orientation, capacity, or liquid level.
- `parts[].kind` must exist in the Part Registry.
- `parts[].semanticRole` should be stable and domain-specific.
- `qualityRequiredRoles` can add roles beyond required parts.
- `forbiddenRoles` should prevent common wrong-domain details.
- `shapeCount` controls QA expectations.
- Control rooms, MCC rooms, labs, substations, and other occupied-building stations should use
  `preferredResolver: "profile-parts"` instead of `catalog-item`, with roles for the building body,
  roof cap/parapet, door/opening, windows, panels, and service entries.
- Packaged boilers can use a rectangular casing, but should also include boiler-specific process
  features such as a stack, steam drum or tube bank, steam header/manifold, burner opening, platform,
  and control box. Avoid profiles that are only `generic_body` plus one accessory.

## Generated Files

The scaffold writes:

- `pack.json`
- `README.md`
- `profiles/generated.json`
- `factory-architectures/generated.json` when `factoryArchitectures` is provided
- `process-templates/generated.json` when `processTemplates` is provided
- `quality-rules/generated-quality.json`
- `<pack-id>-<version>.zip` beside the generated source directory, unless `--skip-zip` is used

The generated `README.md` labels the pack as `factory-capable` or `device-only` and lists supported factory/process templates when factory creation is enabled.
The generated `pack.json` uses schema v2, includes `dependsOnPlugins`, and writes inferred
`equipmentBindings` for profiles that map to factory equipment nodes.

Run validation after generation:

```bash
bun apps/editor/scripts/profile-pack-qa.ts <pack-id>@<version> --validate-only
```
