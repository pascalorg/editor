# Curtain walls

Select a wall and choose **Wall type → Curtain wall** in its properties. Curtain walls remain wall nodes: they use the same drawing tools, dimensions, curve controls, selection, and hosted doors/windows. Switching back to Standard preserves curtain settings; switching to Curtain wall preserves standard wall finishes and trim settings.

## Construction and framing

Construction and framing are independent settings. Stick-built walls have continuous grid members. Unitized walls have separate framed modules and adjustable joints. Either can use fully capped, vertical-cap, horizontal-cap, or structural-glazing framing. Uncapped members sit behind the glazing. Joint controls appear for unitized or uncapped configurations.

This distinction follows the assembly and glazing options described by [Schüco's unitized system](https://www.schueco.com/uk/specifiers/magazine/new-unitised-system) and its [stick-system structural glazing](https://www.schueco.com/de-en/fabricators/products/facades/mullion-transom-facades/sfc-85-sg-hi).

## Settings

Numeric curtain controls and wall dimensions preview through temporary overrides while dragging or typing. Release, Enter, or leaving the field commits one undoable scene change. Escape cancels the preview. Glass tint previews until the color field loses focus; dropdown choices commit immediately.

- Columns and rows independently support panel count, maximum spacing, or fixed spacing. Fixed spacing offers start, center, and end alignment, following the grid controls described in [Revit's curtain wall properties](https://help.autodesk.com/cloudhelp/2026/ENU/Revit-ArchDesign/files/GUID-B9263125-74EA-4C78-AAAA-F40916EFE2DB.htm).
- Frame depth uses the existing wall thickness. Mullion, transom, and border widths have separate controls.
- Default panels can be glass, solid, or empty. A solid top or bottom row creates a spandrel band.
- Select an individual panel in the clickable diagram or with column/row controls. The diagram highlights the selected cell, and the panel indicates whether it has a custom infill. Reset is enabled only for an override. Individual panels can override the default or spandrel setting. Columns count from the wall start; rows count from the bottom. Reset removes the override. Overrides outside a resized grid are retained if that grid grows again.
- Glass appearance follows panel layout and infill settings. Opacity is shown as a percentage; glass controls appear only when the wall contains glass. Painted glass keeps its material until **Use glass settings instead** is explicitly selected.
- Apply frame and solid-panel finishes directly with the paint tool. The paint tool exposes separate frame, glass, and solid slots; the wall panel keeps only the glass tint color control.
- Existing Door and Window tools cut through the curtain geometry. Empty infill removes the panel while retaining its surrounding frame.

## Rendering and limits

The 3D mesh follows curved walls and clips against the existing wall envelope for hosted openings, joins, and support profiles. The 2D floorplan shows frame and panel sections with door/window gaps. Standard wall bands and trim are hidden while curtain mode is active.

Each grid axis is limited to 32 panels. When spacing would exceed that limit, spacing expands to fit. Frame widths and panel thickness are constrained to fit small cells and shallow walls.

This is an architectural geometry model. It does not model fabrication profiles, gaskets, anchors, thermal performance, individual insulating-glass layers, spider fittings, double-skin facades, or operable-panel hardware. Curved walls use curved infill. Floorplan door/window gaps follow the opening profile at the section height.


## Doors in curtain walls

Use the existing Door tool on a curtain wall. Rectangular doors automatically receive two entrance jambs and a header outside the door opening. These use the wall's border width, depth, and frame material, including paint-tool materials. The doorway clears intersecting infill, mullions, transoms, and the bottom rail; glazing above the header remains. The door retains its own frame, threshold, leaf type, glazing segments, hardware, and paint settings.

Entrance framing is derived from the effective door dimensions and position, so it follows live moves and resizing without storing additional nodes. Deleting a door restores the curtain grid. Floorplan sections use the same entrance layout. Rounded and arched doors and windows receive a surround following their actual profile, including arch height and individual corner radii. Windows receive a full surround; doors retain an open bottom. The floorplan section follows the same outline.

This models an integrated framed entrance, as described in [Kawneer's entrance systems](https://www.kawneer.com/products/doors-and-entrances/260-360-560-insulclad-thermal-entrances/). Doors can span grid cells; this does not implement Revit's panel-replacement placement workflow.
