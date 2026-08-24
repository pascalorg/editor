# Circular tower-cap roof research

## Recommendation

Call the first feature **Conical roof** in the UI and `conical` in the roof-type schema. "Turret roof" says where the roof is used, not what shape it has. "Pepperpot" and "candle-snuffer" are picturesque aliases, but official records apply both names to more than one profile.

The first implementation should be a regular cone on a circular plan. Its editable variations belong to one feature: support diameter, pitch, eave overhang, roof build-up, circular eave trim, material, and optional finial. A steep cone is still a cone. Do not add `pepperpot` or `turret` as separate shape values.

Bell-cast, ogee, onion, and domed caps are established forms, but they are not pitch settings on a cone. They need curved radial profiles and different controls. Add them later as explicit, discriminated roof profiles. They may share a private surface-of-revolution geometry helper and the same placement/trimming system, but should not be hidden behind a free-form "curvature" slider.

## What the requested roof is called

The Getty Art & Architecture Thesaurus defines a [conical roof](https://www.getty.edu/vow/AATFullDisplay?find=drypoint&logic=AND&note=&subjectid=300411464) as a roof circular in plan that rises to a point as a regular cone. Historic England uses the same term for real tower caps, including a [cylindrical stair turret with a conical roof](https://historicengland.org.uk/listing/the-list/list-entry/1263108) and a [circular stair turret rising from an aisle roof](https://historicengland.org.uk/listing/the-list/list-entry/1191273).

That gives the product a precise name:

- UI item: `Conical roof`
- Schema value: `conical`
- Descriptive copy: `A circular roof that rises to a single point, commonly used on towers and turrets.`

"Conical turret roof" is useful prose when the host matters. It is redundant as the stored shape name.

## Established circular tower-cap forms

| Form | Architectural distinction | Product treatment |
|---|---|---|
| Conical roof | Circular plan, straight radial profile, one apex. Getty calls the full shape a regular cone. | Implement now as `conical`. Pitch or rise changes do not create a new type. |
| Bell roof or bell-cast roof | A curved or flared cap whose lower edge opens outward like a bell. The term is plan-independent: Historic England records both [bell-cast roofs on stair towers](https://historicengland.org.uk/listing/the-list/list-entry/1388072) and a [bell-cast pyramidal tower roof](https://historicengland.org.uk/listing/the-list/list-entry/1344559). "Bell-cast" can also describe only the eave flare on an otherwise different roof. | Future explicit profile. Do not model it as cone pitch. Store its flare or control points in a profile-specific object. |
| Ogee roof or ogee dome | Its section uses an ogee, a continuous double curve. Getty's architectural glossary describes an [ogee as a convex and concave S-curve](https://www.getty.edu/publications/resources/virtuallibrary/9780892369812.pdf). Historic England identifies a [ribbed ogee dome on a circular bay](https://historicengland.org.uk/listing/the-list/list-entry/1474405) and an [ogee roof forming a corner turret](https://historicengland.org.uk/listing/the-list/list-entry/1265525). | Future explicit profile. It needs at least an inflection position and upper/lower bulge controls, or a fixed preset with height and flare controls. |
| Ogival roof | Historic descriptions sometimes use "ogivally arched" for a pointed curved cap, as in this [observatory roof with an onion dome above](https://historicengland.org.uk/listing/the-list/list-entry/1201700). Usage is less consistent than `ogee`. | Use `ogee` in the UI. Keep `ogival` as a search alias, not a separate enum value. |
| Onion dome | A pointed bulbous dome. Getty specifies that it is wider than its supporting drum and normally taller than it is wide in the [AAT onion-dome record](https://www.getty.edu/vow/AATFullDisplay?find=nanny&logic=OR&note=&subjectid=300001285). Historic England records tower onion domes with lanterns and finials, including [Leicester Hebrew Congregation](https://historicengland.org.uk/listing/the-list/list-entry/1389696). | Future explicit profile. Its maximum radius can exceed the host radius, so it needs bulge position and bulge ratio rather than cone pitch. |
| Dome | A spherical or spherical-section roof over a circular, elliptical, or polygonal base in the [Getty AAT definition](https://www.getty.edu/vow/AATFullDisplay?find=&logic=&note=&subjectid=300001280). Historic England records a [circular lock-up with a domed stone roof](https://historicengland.org.uk/listing/the-list/list-entry/1016741) and a [shallow domed roof on a circular Martello tower](https://historicengland.org.uk/listing/the-list/list-entry/1061124). | Future explicit profile. A dome needs rise or sphere-radius controls and may be shallow, hemispherical, or raised. It should not inherit cone pitch semantics. |
| Cupola | Getty describes a [cupola](https://www.getty.edu/vow/AATFullDisplay?find=Wood&logic=AND&note=&subjectid=300002230) as a small dome or bulb that crowns a turret, roof, or larger dome. It may sit on pillars or a lantern. This is an appendage or scale/use term, not one outline. | Model later as a hosted roof accessory or small roof assembly. Do not use `cupola` as a conical profile. |
| Pepperpot | Historic England uses "pepperpot" for [lead-domed turrets](https://historicengland.org.uk/listing/the-list/list-entry/1238078), an [ogee slated pepperpot roof](https://historicengland.org.uk/listing/the-list/list-entry/1231513), and a [low stair-turret roof](https://historicengland.org.uk/listing/the-list/list-entry/1303073). It therefore does not identify one geometry. | Search alias and descriptive tag only. Never a roof-type value. |
| Candle-snuffer | Official records use the nickname for a [conical candle-snuffer roof](https://npgallery.nps.gov/GetAsset/d6b818ed-7345-477e-b94a-9aeb58ea6cf5) and for an [ogee-profile candle-snuffer](https://npgallery.nps.gov/GetAsset/5dbd5b06-b23d-44d3-9fda-032eae107a23). | Search alias only. It is no more precise than `pepperpot`. |
| Pyramidal or tented cap | Straight roof faces rise over a square or polygonal plan. It can look similar at a distance but is not circular. | Keep in the hip/pyramidal roof family. A faceted polygonal cap must not silently result from lowering the cone mesh resolution. |

This list deliberately excludes mansard tower roofs, Rhenish helms, broach spires, and castellated flat tops. They are real tower terminations, but they are not circular-profile caps and do not belong in this feature.

## Scope of the first feature

### Geometry

A regular cone has one architectural profile. In a vertical section, radius decreases linearly from the eave to zero at the apex. The necessary design controls are:

- circular support diameter or radius;
- pitch, with rise derived from the radius using the same pitch convention as other Pascal roof segments;
- sloped eave overhang;
- wall height or placement elevation;
- deck thickness and covering thickness;
- circular fascia/eave-trim dimensions;
- material assignments for roof surface, edge trim, and wall/body;
- optional finial preset and size.

The editor should expose pitch, not pitch and rise as two independent stored values. One must derive from the other. The optional finial does not change the roof profile. Historic England records a [circular stair turret with a conical roof and metal finial](https://historicengland.org.uk/listing/the-list/list-entry/1267310), and the National Park Service records a [round turret whose cone terminates in a circular finial](https://npgallery.nps.gov/GetAsset/0bc997ab-a2ca-46b0-9944-23f77ec0002c/).

Mesh tessellation is a renderer detail, not an architectural setting. If a later design needs an octagonal or twelve-sided cap, that is a polygonal/tented profile with an intentional side count. It is not a low-resolution cone.

### Fit with the current roof model

Pascal's [`RoofSegmentNode`](../packages/core/src/schema/nodes/roof-segment.ts) already stores roof type, footprint dimensions, pitch, wall height, deck and covering thickness, overhang, trim, surface materials, and hosted accessories. A cone belongs in that roof family rather than in a new top-level node family.

There is one important mismatch. A true conical roof has one plan diameter, while the current segment has independent `width` and `depth`. For `conical`, every creation and resize path should maintain `width === depth`, or the schema should add one canonical diameter field. Using `min(width, depth)` or allowing an ellipse would violate the architectural definition and produce surprising resize behavior.

The existing rectangular `left`, `right`, `front`, and `back` trim distances also cannot describe a round cut. Conical placement needs a circular footprint/cutter, not an approximation made from those four fields.

## Placement, cutting, and trim behavior

There are two placement cases and they should remain distinct.

### Cap on a circular tower or wall

Snap the cone center to the circular wall center and derive or copy the support diameter. The cone remains intact. Its underside seats on the wall-top ring, and its eave projects beyond that ring by the configured overhang.

If the wall is independently resizable, define whether the roof follows the wall diameter or keeps a manual diameter. The default should follow the host. A detached/manual mode can keep the roof independent.

### Turret passing through an existing roof

When a round tower rises through a larger roof, the tower body is the cutter. Subtract its vertical circular envelope from every intersected sibling roof deck and covering, then union or compose the tower and cap as visible solids. Do not trim the cone against the host roof as the normal case. If the cap intersects the larger roof, the tower is too short or the placement is invalid.

The cut and flashing must update when the tower moves, its diameter changes, or the host roof changes pitch. The placement system should handle:

- a circle crossing one or several host roof faces;
- intersections at hips, valleys, and ridges;
- partial circles near an eave or roof boundary;
- deterministic ownership when several roof segments overlap;
- removal of the cut when the turret or cap is deleted;
- selection and movement in both floorplan and 3D views.

Generate an intersection loop from the circular tower wall against the actual roof surface. Use it for the cut boundary and a later flashing/skirt mesh. A rectangular bounding-box cut will remove too much roof at diagonal slopes.

The National Park Service's roofing guidance treats the roof as a weathering membrane and calls out careful flashing around a steep conical cupola to promote runoff in [Preservation Brief 4](https://www.nps.gov/orgs/1739/upload/preservation-brief-04-roofing.pdf). That supports modeling the junction as part of placement rather than leaving two intersecting meshes. The same source shows a finial, ribbing, and a lead-coated copper covering, but those are finish/accessory choices, not new roof profiles.

## Suggested delivery boundary

Ship the first version with:

1. `conical` as one new roof type;
2. a locked circular footprint;
3. pitch, diameter, overhang, wall height, thickness, materials, circular eave trim, and optional finial;
4. 2D and 3D placement and resize parity;
5. a round cutter for sibling roof geometry when the tower passes through another roof;
6. placement validation that prevents the cap itself from intersecting the host roof.

Defer:

- bell-cast and ogee profiles;
- onion domes;
- spherical and shallow domes;
- lanterns and multi-stage cupolas;
- polygonal/tented caps;
- free-form profile editing;
- structural framing and code claims.

When curved variants arrive, prefer explicit profile records such as `cone`, `bell`, `ogee`, `onion`, and `dome`, each with its own validated controls. They can live under the same roof-segment node and share placement, materials, cutting, and selection behavior. Separate top-level node types would duplicate the hard parts without adding useful domain meaning.

## Source-quality note

Getty AAT supplies controlled architectural definitions. Historic England and National Park Service records show how heritage professionals apply the terms to actual towers and roof details. The product recommendations about schema shape, cutting, and delivery order are engineering conclusions drawn from those definitions and the current Pascal model.
