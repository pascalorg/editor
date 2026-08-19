# Shed / Lean-to Roof Extension Research

## Scope

The reference images show an **attached, open-sided lean-to canopy** rather than a new main-roof shape: one roof plane has a high edge at an existing building and a low edge carried by a beam and posts. The examples vary mainly in span and context:

- a long veranda across a facade;
- a courtyard canopy terminating against a second building; and
- a small entrance canopy with two front posts.

This distinction matters in Pascal because `RoofSegmentNode` already has a `roofType: 'shed'`. The proposed feature adds attachment, supports, framing, and drainage to that one-plane geometry.

## Terminology

- **Shed roof** means a roof with one sloping plane in the [California State University Channel Islands master-plan glossary](https://www.csuci.edu/fs/pdc/documents/csuci2007masterplan.pdf).
- **Mono-pitched roof** is the corresponding UK term: the [City of Edinburgh Council glossary](https://www.edinburgh.gov.uk/housing/improving-edinburgh-neighbourhoods/7) defines it as a roof with one sloping side, usually attached to a wall. [Bury Council](https://www.bury.gov.uk/housing/housing-services/your-home/repairs/alterations-to-your-property/terms-and-conditions) notes that a mono-pitched roof is often called a **lean-to**.
- **Skillion roof** is the common Australian term for the same single-plane form; the [Australian Government's YourHome glossary](https://www.yourhome.gov.au/glossary) lists shed-style and lean-to as aliases.
- **Rafters** are the sloping members carrying a pitched roof; **purlins** run horizontally and support rafters, according to the same [City of Edinburgh glossary](https://www.edinburgh.gov.uk/housing/improving-edinburgh-neighbourhoods/7). Actual light-metal canopy systems may instead place panels across regularly spaced supports, so the editor should treat framing layout as a strategy rather than assume that every assembly contains both rafters and purlins.

For the product UI, **Lean-to extension** or **Attached canopy** is clearer than just **Shed roof**. It avoids confusion with both a storage shed and Pascal's existing standalone shed-shaped roof segment.

## Typical assembly and load path

A conventional attached wood canopy can be represented as this hierarchy:

1. Roof covering and optional sheathing/deck.
2. Repeated sloping rafters, or a covering-specific support layout.
3. A high-side support at the building: normally a structurally fixed wall ledger, or a separate high beam and posts for a freestanding/independent canopy.
4. A low-side beam at the eave.
5. Repeated posts/columns, with top bracing where required.
6. Post bases and footings carrying loads to the ground.
7. Flashing at building abutments and a gutter/downspout at the low eave.

The [City of San Diego patio-cover bulletin](https://www.sandiego.gov/development-services/forms-publications/information-bulletins/206) is a useful official example of this system. It requires posts to be anchored at the bottom and braced at the top; describes replacing the building-side beam with a ledger attached to wall studs; says patio rafters must not be supported solely by existing rafter tails or fascia; and warns that existing headers beside openings may need verification. Its prescriptive sizes and fastener schedules are local design rules, not universal Pascal defaults.

The first-party [Stratco Outback Skillion installation guide](https://www.stratco.com.au/siteassets/pdfs/stratco-outback-skillion-installation-guide15-10-20.pdf) shows the same assembly in a proprietary metal system: columns, low beam, rafters, purlins, high-side back channel, cladding, barge flashing, gutter, and downpipe. It also illustrates purlins placed either between or above rafters and roof sheets turned up at the high end and down toward the gutter. Its 5-degree fall and component dimensions are product-specific examples, not general construction defaults.

The same bulletin requires custom designs to include framing and foundation plans, sections, connection details, and structural calculations. Pascal should therefore model the geometry and assembly accurately but should not label arbitrary member sizes or spans as structurally compliant unless a jurisdiction/load profile and verified calculation engine are added.

## Weathering and drainage

- The high-side wall intersection needs a modeled flashing/abutment condition. [IRC 2015 R903.2.1](https://codes.iccsafe.org/s/IRC2015/chapter-9-roof-assemblies/IRC2015-Pt03-Ch09-SecR903.2.1) requires flashing at wall/roof intersections, roof slope or direction changes, and roof openings, illustrating that this is part of the assembly rather than decorative trim.
- Water should run away from the high-side attachment toward the low eave. The [San Diego bulletin](https://www.sandiego.gov/development-services/forms-publications/information-bulletins/206) uses a minimum slope of 1/4 inch in 12 inches for the patio covers in its scope.
- Minimum slope depends on the selected covering/system. For example, manufacturer specifications list a 2-degree minimum for [LYSAGHT TRIMDEK](https://lysaght.com/profiles/trimdek) and product-dependent 1- or 2-degree minima for [LYSAGHT KLIP-LOK](https://lysaght.com/profiles/klip-lok). The editor should not encode one global minimum as a universal construction rule.
- Gutters belong on the low eave. A side that terminates at another building, as in the courtyard image, also needs a sidewall/end-abutment condition rather than allowing the roof edge to pass through the wall.

## Current Pascal capabilities and missing semantics

- [`RoofSegmentNode`](../packages/core/src/schema/nodes/roof-segment.ts) already supports `shed`, footprint width/depth, pitch, wall height, deck and covering thickness, overhang, trim, materials, and hosted roof accessories. Its current shed geometry slopes from local `-Z` (high) to `+Z` (low).
- [`RoofNode`](../packages/core/src/schema/nodes/roof.ts) already groups multiple roof segments and provides roof-level surface materials.
- [`ColumnNode`](../packages/core/src/schema/nodes/column.ts) already provides reusable post/pillar geometry, dimensions, materials, and several braced support styles.
- [`GutterNode`](../packages/core/src/schema/nodes/gutter.ts) already attaches to a roof segment eave and supports outlets that can connect to downspouts.

What is missing is the semantic relationship that makes these parts one editable extension: a high-side host/attachment, a low-side beam, a governed row of columns, optional exposed framing, flashing, derived elevations, and collision/clearance rules. A wall-less shed segment plus independently placed columns can approximate the pictures visually, but it will drift apart when resized or moved.

## Implementation shapes to consider

### 1. Manual composition from existing nodes

Create a wall-less `shed` roof segment, then place columns and a gutter separately.

- **Strengths:** smallest implementation and useful as a geometry proof.
- **Limitations:** no ledger/beam/flashing, no shared selection or lifecycle, and resizing the roof does not reliably update posts or drainage.
- **Use:** prototype or short-lived MVP, not the durable model.

### 2. New composite `lean-to-extension` node (recommended)

Store the design intent once and derive/render the roof plane, ledger or high beam, low beam, repeated supports, flashing, and optional framing. Reuse existing column and gutter behavior through owned children or well-defined references where independent editing is valuable.

- **Strengths:** one placement flow, coherent resize/move behavior, works against buildings with any main roof type, and gives room for multiple support/attachment strategies.
- **Tradeoff:** requires a new schema/definition/renderer/system and explicit ownership rules.

The host should normally be a **wall face or facade interval below the eave**, not the main roof type. Gable, hip, gambrel, mansard, flat, and shed roofs can all accept the same lean-to if their wall/eave geometry provides clearance. Direct attachment to an existing roof plane is a different and more complex join and should be a later explicit attachment mode.

### 3. Extension fields on every roof segment

Add post/beam/ledger fields directly to `RoofSegmentNode` and activate them when desired.

- **Strengths:** reuses the current roof editing surface directly.
- **Limitations:** mixes a main-roof shape with an accessory assembly, leaves many fields inert for ordinary roofs, and makes attachment/ownership harder to express.
- **Use:** only if product semantics intentionally treat every roof segment as a potential complete canopy assembly.

## Parameters a configurable editor should expose

### Essential geometry

- Host and placement: `hostWallId` or facade reference, along-wall offset, span/width, outward projection, and left/right end conditions.
- Vertical geometry: high attachment elevation plus either pitch or low-eave elevation. The third value is derived: `lowEave = highEdge - projection * tan(pitch)`.
- Dependency lock when editing: preserve **high edge**, preserve **low edge**, or preserve **pitch**. This prevents ambiguous resize behavior.
- Plane orientation: downhill direction, local rotation where detached, and alignment/clearance below the host eave.
- Overhangs: low-eave, high-side, and both end overhangs independently; one scalar overhang is insufficient at wall abutments.
- Roof build-up and appearance: deck/panel thickness, covering/material, fascia/edge material, underside/soffit material.

### Attachment and supports

- High-side mode: `wall-ledger`/back channel, `independent-high-beam`, and later `reinforced-fascia` or `roof-plane-tie-in`. The first-party [Stratco attached-roof guide](https://www.stratco.com.au/siteassets/pdfs/patios_outback_flat_attached_install.pdf) illustrates wall, reinforced fascia, suspension, and over-roof attachment details, supporting an explicit mode rather than one generic connection.
- Ledger/high-beam dimensions and vertical offset; whether it is visible.
- Low beam dimensions, inset from the drip edge, and material.
- Post layout: count **or** target spacing, left/right setbacks, section/preset, material, and optional bracing. Post heights should derive from beam elevation and the support surface instead of being duplicated free values.
- Support-surface/footing references and a visual footing/post-base option.
- Framing strategy: hidden, rafters, purlin-like supports, or a covering-specific system; member dimensions, spacing, end inset, and material.

### Weathering

- High-side apron/counterflashing enabled, projection, and material.
- Left/right termination: open verge, wall abutment/flashing, or joined continuation.
- Low-eave gutter enabled, profile/size, outlets, and downspout positions. Prefer composing the existing gutter/downspout nodes over duplicating their schemas.
- Covering-specific minimum-pitch advisory. Treat warnings as product/jurisdiction guidance, not proof of compliance.

### Placement and validation

- Snap the high edge to a valid wall/facade interval, derive the outward normal, and preview the low beam/post row during placement.
- Reject or warn on collisions with the host roof/eave, adjacent buildings, wall openings, and neighboring extensions.
- Warn when a ledger is placed on fascia/rafter tails rather than a valid wall support, following the San Diego bulletin's attachment distinction.
- For a canopy between buildings, resolve both end abutments and drainage explicitly.
- Keep a clear visual distinction between **modeled appearance** and **structurally verified design**.

## Suggested delivery order

1. Prove the parametric plane, high/low elevation relationship, host-wall snap, low beam, and governed column row.
2. Add resize/move behavior in both 2D and 3D, with the selected dependency lock.
3. Compose the existing gutter/downspout system and add high-side/side flashing geometry.
4. Add exposed framing strategies and covering-specific advisories.
5. Consider roof-plane tie-ins and structural verification only as separately scoped capabilities.

## Source-quality note

The construction sources above are official government guidance, an official model-code publication, and first-party roofing-system specifications. Their numeric requirements are examples tied to a jurisdiction or product. They support the assembly model and validation vocabulary; they should not be copied into Pascal as universal engineering defaults.
