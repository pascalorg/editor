# Glazed roofs

Select a gable, straight shed or barrel roof and choose **Roof system → Glazed**. The roof panel applies the choice to all its segments. Select an individual segment to change only that segment or edit individual panels. Other roof shapes retain the Standard system.

Glazing replaces the opaque deck and covering with panes and framing. Existing drawing, placement, pitch, overhang, resize, rotation and trim controls still apply. Drawing another segment into a glazed roof inherits its glazing settings. Switching back to Standard keeps the glazing configuration and paint for later use.

## Settings

- Across and along-slope grids support panel count, maximum spacing and fixed spacing. Fixed spacing can align to the start, center or end. Spacing measures distance on the slope, rather than its horizontal projection. Each grid direction has at most 32 cells, matching the curtain-wall grid limit.
- Frame width, frame depth and pane thickness control the construction. Glass tint, opacity and roughness control appearance. Frame color sets the unpainted frame finish.
- Default infill can be glass, solid or empty. On a selected segment, choose a face, column and row to override one panel. Reset removes its override. Overrides survive shrinking and enlarging a grid. Empty cells retain their framing.
- Glazed end infill closes the triangular ends of a gable roof or the sloped side ends of a shed roof above the wall-top datum. The enclosure below remains the room walls' responsibility.
- The paint tool exposes Frame, Glass and Solid panels separately. Painted slots take precedence over the appearance settings.

Numeric glazing edits preview through live overrides and commit as one undo step. Escape cancels the numeric preview. Color edits commit when the field loses focus. Editing several roof segments from the roof panel remains one undo step.

The floor plan includes the pane grid. Glass panes do not cast opaque shadows; frames and solid infill do. Hosted rooflights cut through panes and framing, and empty cell interiors do not accept roof-hit placement. Existing gutters follow the roof's eaves. Automatic tiled-roof ridge vents are suppressed while glazing is active.

## Barrel roofs

Choose **Barrel** on a roof segment. Length is the longitudinal dimension, span is the eave-to-eave depth, and rise sets the circular arch height above the eaves. Rise is limited to half the span, allowing arches up to a semicircle. If omitted, rise defaults to one quarter of the span. Pitch has no effect on barrel roofs.

Arch bays controls the number of flat facets around the arch, from 4 to 32 with a default of 12. Glass panes stay flat. This version does not model curved glass or cold-bent sheets. Across and along grids subdivide each bay, while end infill follows the arched profile. Individual panel overrides identify arch faces as `barrel-0` through `barrel-31`. Glazing changes, rise and bay edits preview live and commit once per gesture.

Standard construction provides an opaque covering and optional wall shell using the same arch. Overhang extends along the length. Eaves stay at the authored span. Resizing the span with a handle preserves rise until the semicircle limit is reached; the peak handle adjusts rise. The floor plan draws the crown axis and projected pane grid, without a constant-pitch label on the curved arch.

Agents can use `roofType: "barrel"`, `barrelRise: 1.4` and `barrelSegments: 12` with either roof system. `create_roof` rejects a rise greater than half the span before creating nodes. Scene updates that shrink the span retain the authored rise and limit the displayed rise to the new span.

## Agent authoring and exports

`create_roof` accepts `roofSystem: "glazed"` with `roofType: "gable"`, `"shed"` or `"barrel"`. Its optional `glazing` object uses the same schema as the inspector. Existing node update operations can edit `roofSystem`, `glazing` and glazing paint slots on a roof segment.

```json
{
  "roofType": "gable",
  "roofSystem": "glazed",
  "width": 6,
  "depth": 4,
  "pitch": 30,
  "glazing": {
    "across": { "layout": "maximum-spacing", "spacing": 1.2 },
    "along": { "layout": "count", "count": 2 },
    "frameWidth": 0.05,
    "frameDepth": 0.08,
    "glassThickness": 0.008,
    "glassOpacity": 0.3,
    "glazedEnds": true
  }
}
```

Model exports use the rendered panes and frames. Manufacturing print geometry uses separate closed pane and frame solids; the existing print restrictions on trim and cutting accessories still apply. Frame and pane thicknesses feed the existing print feature-thickness checks.

## Scope

This is a roof construction option. It does not automatically create curtain walls, remove room ceilings or add ventilation hardware. Edit those independently when composing a greenhouse or conservatory. Curved sheets, Gothic roofs, hip glazing and fully designed greenhouse presets are later additions. The architecture model does not certify structural or thermal performance.
