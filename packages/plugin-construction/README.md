# Construction

An early foundation for homebuilders and the contractors and engineers reviewing their models. One opt-in plugin presents the workflow, building element categories and expected outputs in both the standalone editor and Community.

## Available now

- **Workflow:** understand the model, review the construction, prepare the handoff.
- **Elements:** eight categories covering the site, envelope, structure, electrical, plumbing, heating and cooling, finishes, and reference models. Expanded rows explain what belongs in each category.
- **Outputs:** five families covering PDFs, images, renders, 3D objects, and schedules/data. Every output explains its recipient, contents, prerequisites and current availability, with a visual placeholder.
- **Model inventory:** download a CSV of recognized scene records, scoped to one building and its shared site. Multiple buildings require an explicit choice. Unrecognized and unassigned records are reported separately. Counts represent stored records, not measured quantities, derived framing members or engineering completeness.

The eight generation outputs are explicitly planned. This package does not run discipline engines, create sheets, capture images, export geometry or claim permit readiness. Existing construction plugins retain their current ownership and installation state. Resolving their preservation, persistence and capture findings is still required before migrating those capabilities.

## Integration

`constructionPlugin` is a data-only manifest with no node definitions. `constructionHostPanel` supplies the lazy project panel and an optional lazy `overview` for the plugin manager. The panel reads the host scene store without changing it. Installation uses the host's existing per-project plugin controls.

`./catalog` exports the shared workflow, element and output definitions. `./guide` exports a scene-independent guide used by both apps at `/construction`, so users can understand scope and deliverables before opening a project. Community also links it from the workspace sidebar.

The guide uses host theme tokens and the editor's existing `Button` through `@pascal-app/editor/ui`; it does not import the viewer. Hosts must transpile this source package and include `src` in their Tailwind source scan.

This first slice lives in the editor workspace so it can be reviewed locally in both hosts. The charter still targets an independently distributed plugin; extraction and engine composition are subsequent work, not implied by this package location.

## Verification

From the editor workspace:

```sh
bun test packages/plugin-construction/src packages/editor/src/lib/plugin-panels.test.ts
bunx --no-install tsgo --noEmit -p packages/plugin-construction
```

Build the core/viewer dependency declarations first if the checkout's `dist` files are stale. Inventory tests cover ambiguous and deleted scopes, hosted children, shared sites, unknown records, scans, cyclic ancestry, immutability and safe CSV serialization.

Browser checks: browse `/construction` without a project; switch destinations and output families; expand a placeholder; open Plugins → Construction before installation; install it in a local test scene; export the current model inventory; uninstall and confirm the panel disappears.
