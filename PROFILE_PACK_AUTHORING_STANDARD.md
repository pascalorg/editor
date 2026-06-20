# Profile Pack Authoring Standard

This document defines the project-local contract for AI-generated industrial profile packs.
Profile packs are installable data assets. Skills, prompts, and batch generators may create
drafts, but the final package must pass the validators and QA runners in this repository.

## Package Shape

Each package is a directory or zip with `pack.json` at the root.

```txt
industry.example.basic-0.1.0/
  pack.json
  README.md
  profiles/*.json
  layouts/*.json
  part-presets/*.json
  editable-schemas/*.json
  quality-rules/*.json
```

`pack.json` must use stable identifiers and relative resource paths:

```json
{
  "id": "industry.cement.basic",
  "name": "Cement Basic Equipment Pack",
  "industry": "cement",
  "version": "0.1.0",
  "schemaVersion": "1.1",
  "knowledgeSchemaVersion": "1.0",
  "appCompatibility": ">=0.8.0",
  "locale": ["zh-CN", "en-US"],
  "profiles": ["profiles/pyroprocess.json"],
  "layouts": ["layouts/pyroprocess-layouts.json"],
  "partPresets": ["part-presets/cement-parts.json"],
  "editableSchemas": ["editable-schemas/common-equipment.json"],
  "qualityRules": ["quality-rules/cement-quality.json"]
}
```

Rules:

- `id` format: `industry.{industry}.{basic|extension}` or
  `industry.{industry}.{domain-extension}`.
- `version` uses semver.
- All paths are relative, safe paths inside the package.
- A basic package must be useful without manually installing another package.
- Extension packages may use `dependsOn`; installation resolves dependencies automatically.
- Do not mix unrelated industries in one package.

## Device Profiles

Profiles describe equipment knowledge, not final shapes.

Required fields:

- `id`
- `name`
- `aliases`
- `family`
- `layoutFamily`
- `primarySemanticRole`
- `parts`
- `qualityRules`

Rules:

- `parts[].kind` must be executable by the current Part Registry.
- `parts[].semanticRole` must be domain-specific and stable.
- `primarySemanticRole` must be represented by at least one part or generated shape.
- Complex equipment should reference `layoutTemplate`.
- Reusable style and parameter defaults should go into `partPresets`, not repeated in every profile.
- Natural-language editability should be expressed through `editableSchemaRef` and
  `editableOverrides`.

## Layout Templates

Layout templates describe spatial relationships and proportions for complex equipment.

Rules:

- Every referenced `layoutTemplate` id must exist in the package resources or a dependency.
- Templates should expose bounds or placement intent when possible.
- Layouts should not duplicate profile semantics.

## Part Presets

Part presets describe reusable industry-specific appearance and parameters for existing part kinds.

Rules:

- Every profile `partPresets` reference must resolve to a preset id.
- Presets must not invent new executable part kinds.
- Prefer shared presets for frames, hoppers, nozzles, ladders, rollers, and drive units.

## Part Layout Hints

Profiles should use semantic layout hints before absolute `position` values.

Supported fields on `parts[]`:

- `attachToRole`: attach to a previously declared part by `semanticRole` or `kind`.
- `anchor`: `top`, `bottom`, `front`, `back`, `left`, `right`, `shell_center`, `drive_side`,
  or `service_side`.
- `side`: fallback side when `anchor` is omitted.
- `offset`: optional `[x, y, z]` correction after anchor placement.
- `arrayAlong`: distribute repeated parts along `length`/`x`, `width`/`z`, or `height`/`y`.

Rules:

- Declare the primary body/shell/frame part before dependent parts that use `attachToRole`.
- Use `arrayAlong` for repeated rollers, rings, supports, trays, stages, or vents.
- Prefer `service_side` for ladders, access platforms, control panels, and inspection items.
- Prefer `drive_side` for motors, gearboxes, couplings, and drive guards.
- Use absolute `position` only for equipment-specific asymmetry that cannot be expressed by anchors.

## Editable Schemas

Editable schemas define what natural language may change after generation.

Rules:

- Profile-specific editability should reference a common schema.
- Device-specific differences belong in `editableOverrides`.
- Do not require every profile to define its own schema.
- Editable values must map to actual composer arguments.

## Detail Budgets

Detail budgets define how much geometry a profile should create before quality scoring.

Rules:

- Use `detailBudget.detailLevel` for the default part detail level: `low`, `medium`, or `high`.
- Use `detailBudget.maxShapes` as the profile-level shape budget unless `qualityRules.shapeCount.max`
  is stricter.
- Use `detailBudget.parts` to override specific parts by `id`, `semanticRole`, or `kind`.
- Supported per-part budget keys include `detailLevel`, `count`, `ringCount`, `spokeCount`,
  `slatCount`, `rungCount`, `boltCount`, `radialSegments`, and `levelCount`.
- Detail budgets must not replace `qualityRules`; they control generation, while quality rules
  judge whether the generated result is acceptable.

Example:

```json
{
  "editableSchemaRef": "conveyor.common",
  "detailBudget": {
    "detailLevel": "low",
    "maxShapes": 52,
    "parts": {
      "cooling_air_box": { "count": 5, "detailLevel": "low" },
      "cooler_grate_bed": { "detailLevel": "low" }
    }
  }
}
```

## Quality Rules

Quality rules define what makes generated geometry acceptable.

Rules:

- Every stable profile must reference a quality rule.
- `requiredRoles` should include the profile's `primarySemanticRole` or a direct alias.
- `shapeCount.max` must be realistic for the package's intended detail level.
- `forbiddenRoles` should prevent common cross-domain failures.
- Complex equipment should include dimension expectations when ratios are visually important.

## Validation Gates

For batch generation, prefer creating a scaffold spec first and then generating the package files:

```bash
bun apps/editor/scripts/scaffold-industry-profile-pack.ts --spec <spec.json> --force
```

Use the strict audit and QA runner before publishing a pack:

```bash
bun apps/editor/scripts/profile-pack-qa.ts industry.cement.basic@0.1.0
```

Required gates:

1. Manifest schema and path safety.
2. Device profile registry validation.
3. Cross-resource reference validation.
4. Deterministic compose smoke through primitive generation.
5. Quality score and role coverage.
6. Rendered screenshot output for review.

AI skills may generate candidate packages, but packages should only be published after these
repository-local gates pass.

## Simulated Cloud Governance

The local simulated cloud lives at `apps/editor/data/profile-pack-cloud/`. It intentionally keeps
both editable source directories and installable zip files:

```txt
apps/editor/data/profile-pack-cloud/
  industry.cement.basic-0.1.0/
  industry.cement.basic-0.1.0.zip
```

Governance is derived from package contents; do not hand-maintain a separate catalog file.

Rules:

- Every source directory with `pack.json` should have a matching `{id}-{version}.zip`.
- Every cloud zip should have a matching source directory for review and rebuilding.
- Basic packs should not depend on other packs.
- Extension packs may depend on basic packs; dependencies must be available in the cloud.
- Cloud installation refuses `blocked` packs.

Cloud publish statuses:

- `publishable`: strict audit passes, dependencies resolve, and audit score is at least `0.85`.
- `needs_review`: strict audit has no hard issues, but warnings reduce the audit score below `0.85`.
- `blocked`: strict audit has hard issues or a dependency is missing.

The Profile Pack Manager page and `/api/profile-packs/cloud` expose the derived catalog summary,
industry grouping, publish status, dependency status, and governance notes.
