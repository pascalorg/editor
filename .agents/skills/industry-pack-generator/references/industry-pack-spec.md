# Industry Pack Scaffold Spec

Use this JSON shape as input to `apps/editor/scripts/scaffold-industry-profile-pack.ts`.

```json
{
  "industry": "cement",
  "id": "industry.cement.basic",
  "name": "Cement Basic Equipment Pack",
  "version": "0.1.0",
  "description": "Focused cement plant equipment pack.",
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
      "layoutFamily": "vessel_layout",
      "family": "tank",
      "defaultDimensions": { "length": 12, "width": 2.2, "height": 2.4 },
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
- `dependsOn`: optional for extension packs, for example `[{ "id": "industry.fine-chemical.basic", "version": ">=0.1.0" }]`.
- `capabilities`: optional. Use `["factory_creation"]` only when the pack includes factory/process knowledge.
- `factoryArchitectures`: required when `capabilities` includes `factory_creation`; otherwise optional. Defines the whole-plant module tree.
- `processTemplates`: required when `capabilities` includes `factory_creation`; otherwise optional. Defines stations, aliases, and station connections.
- `devices`: required non-empty list.

## Factory-Capable Pack Rules

When `capabilities` includes `factory_creation`, QA enforces:

- At least one `factoryArchitectures` resource.
- At least one `processTemplates` resource.
- Every process-template station must be covered by a device profile, native resolver, or catalog resolver hint.
- Every architecture module `stationIds[]` entry must exist in the matching process template.

If the pack only provides equipment profiles, omit `factory_creation`; QA will classify it as a `device-only` pack.

## Device Fields

- `id`, `name`, `aliases`, `parts`, `primarySemanticRole` are required.
- `layoutFamily` defaults to `generic_industrial_layout`.
- `family` defaults to `generic`.
- `defaultDimensions` should describe the whole equipment envelope.
- `parts[].kind` must exist in the Part Registry.
- `parts[].semanticRole` should be stable and domain-specific.
- `qualityRequiredRoles` can add roles beyond required parts.
- `forbiddenRoles` should prevent common wrong-domain details.
- `shapeCount` controls QA expectations.

## Generated Files

The scaffold writes:

- `pack.json`
- `README.md`
- `profiles/generated.json`
- `factory-architectures/generated.json` when `factoryArchitectures` is provided
- `process-templates/generated.json` when `processTemplates` is provided
- `quality-rules/generated-quality.json`

The generated `README.md` labels the pack as `factory-capable` or `device-only` and lists supported factory/process templates when factory creation is enabled.

Run validation after generation:

```bash
bun apps/editor/scripts/profile-pack-qa.ts <pack-id>@<version> --validate-only
```
