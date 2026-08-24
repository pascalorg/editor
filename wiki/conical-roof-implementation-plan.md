# Conical roof implementation plan

## Decision

Add `conical` to `RoofSegmentNode` and expose a **Conical roof** preset under Roof features. Each placement creates an independent `RoofNode` assembly containing the conical segment, so the assembly can be selected and moved separately while reusing roof materials, hosted accessories, merged-roof CSG, and sibling trimming.

The first release is a regular cone over a circular plan. Bell, ogee, onion, and dome profiles are separate future shapes rather than settings on the cone. The terminology and option survey are recorded in [conical-turret-roof-research.md](conical-turret-roof-research.md).

## Data contract

- `roofType` is `conical`.
- `width` is the canonical diameter; all editor creation and resize paths keep `depth === width`.
- Pitch uses the existing roof convention. Rise is `diameter / 2 * tan(pitch)`.
- Rotation is stored for schema consistency but has no visible effect and receives no editing handle.
- `RoofNode.support` records either level placement or a roof-surface attachment. A roof attachment stores the host segment, host-local center, and curb height.
- Rectangular manual trim controls are unavailable. Intersections use the existing solid-to-solid roof trimming pipeline.
- Overhang, wall height, wall/deck/covering thickness, and surface materials remain the existing roof-segment fields.

## Geometry and trimming

1. Generate a closed circular wall-and-cone volume with renderer-owned radial tessellation.
2. Generate deck and covering layers through the existing inset/offset brush path.
3. Feed the solid into the existing merged-roof CSG pipeline. The declared host clips the mounted assembly at its outer surface, matching the chimney rule: the cylindrical body is removed inside the host while the host shell stays intact and the cone remains above it. Plan view keeps the mounted circle visible above the host. A level-supported cone uses the normal area-based overlap rule.
4. Recompute intersections whenever either segment moves or changes dimensions, using the existing roof dependency invalidation.
5. Keep straight-edge gutters and ridge vents unavailable for this profile. Circular eave trim and a finial are follow-up accessories.

## Interaction

- Build panel: selecting **Conical roof** activates the standard roof tool with a conical default.
- Placement surface: `Auto` chooses a complete roof support under the circle and otherwise uses the level. `Ground` always uses the level. `Roof` requires a complete roof support and blocks invalid commits. The contextual HUD chip and `P` cycle these modes.
- 3D placement: the two-point footprint gesture resolves to a circle whose diameter is the larger drag span.
- 2D placement: use the same resolver and committed invariant as 3D.
- Resize: any side handle changes the diameter on both axes; rotation handles are hidden.
- Inspector: show one Diameter control, pitch, wall height, overhang, structure, and materials. Hide rectangular trim, drainage, and ridge-vent automation.
- Floorplan: render and hit-test a circle; approximate it only at the polygon-union boundary used to compute the merged roof silhouette.

## Verification

- Schema parses and serializes `conical`.
- A diameter of 8 m at 45° produces a 4 m roof rise.
- The generated shell is closed and uses one circular eave and one apex.
- Surface height falls linearly with radial distance.
- Placement and every resize path preserve `width === depth`.
- 2D selection and hit targets are circular.
- A mounted conical wall clips at the declared host surface without cutting the host shell or disappearing in plan view.
- A mounted roof attachment survives scene and level cloning with its host segment reference remapped.
- Removing or moving it restores/recomputes the sibling roof.
- Focused unit tests, package type checks, and interactive 2D/3D placement checks must pass before release.

## Follow-up profiles

Introduce an explicit radial-profile discriminator only when the corresponding geometry ships: `bell`, `ogee`, `onion`, and `dome`. Each profile gets validated controls appropriate to its curve and can share the conical placement, material, and CSG infrastructure.
