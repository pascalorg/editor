---
name: industry-pack-generator
description: Generate Pascal industrial profile packs from an industry brief, factory equipment list, or request such as "make a cement/electrolytic aluminum/food processing industry pack"; create a structured pack spec, scaffold profiles and quality rules, validate with repository QA gates, and prepare the pack for the simulated cloud.
---

# Industry Pack Generator

Use this skill to create or expand installable Pascal geometry knowledge/profile packs.

## Workflow

1. Read the current project rules:
   - `PROFILE_PACK_AUTHORING_STANDARD.md`
   - `LLM_PRIMITIVE_GENERATION_ARCHITECTURE.md` when architecture context is needed
   - `references/industry-pack-spec.md` for the scaffold spec shape
2. Identify package scope:
   - Use one focused industry or extension domain per pack.
   - Prefer `industry.{industry}.basic` for a self-contained base pack.
   - Prefer `industry.{industry}.{extension}` with `dependsOn` for extensions.
3. Draft a v2 industry pack spec JSON with equipment profiles, parts, primary roles, aliases, visual cues, quality constraints, and equipment-node intent.
   - For basic packs, include `factoryArchitectures` and `processTemplates`.
   - For extension packs, include them only when the extension adds a new factory-level process.
   - For pump/tank-like equipment, include `nodeKind`, `processPorts`, and `equipmentDefaults` so the scaffold can emit `equipmentBindings`.
4. Run the scaffold:

```bash
bun apps/editor/scripts/scaffold-industry-profile-pack.ts --spec <spec.json> --force
```

5. Validate and QA:

```bash
bun apps/editor/scripts/profile-pack-qa.ts <pack-id>@<version> --validate-only
bun apps/editor/scripts/profile-pack-qa.ts <pack-id>@<version> --limit 3
```

6. Review generated profiles:
   - Ensure every `parts[].kind` exists in the Part Registry.
   - Ensure `primarySemanticRole` appears in required roles.
   - Ensure aliases include Chinese and English terms when useful.
   - Keep `shapeCount.max` realistic; avoid bloated geometry.

## Pack Authoring Rules

- Generate data first, not TypeScript hardcoding.
- Reuse common part kinds from `packages/core/src/lib/part-registry.ts`.
- Default new packages to schema v2 with `dependsOnPlugins` and `equipmentBindings`.
- Use `generic_industrial_layout` unless a known layout family is clearly better.
- Put device-specific knowledge in profiles and quality rules.
- Do not invent a new family/layout for one equipment unless the layout is reusable.
- For unknown equipment, model major visible assemblies: body, frame, drive, ports, platforms, legs, hoppers, ducts, panels, sensors.

## Output Contract

When finishing, report:

- Pack id and output directory.
- Device count and profile ids.
- Whether factory architectures and process templates were generated.
- Validation/QA command results.
- Any low-confidence devices that need visual reference review.
