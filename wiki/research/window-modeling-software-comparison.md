# Architectural Window Modeling: Product Comparison and Pascal Implications

Research date: 2026-09-21  
Scope: Revit, AutoCAD Architecture, SketchUp, Rhino/VisualARQ, and Archicad. Only official vendor documentation was used.

## Executive takeaway

Professional BIM applications treat a window as three connected things:

1. a reusable **type or family** containing construction, geometry, materials, and performance data;
2. a **hosted instance** that cuts and responds to a wall, roof, or other host; and
3. a **documentable asset** with marks, classifications, schedules, quantities, and IFC identity.

Pascal already has the important beginning: a semantic, wall-hosted window with an actual opening, several opening forms, frame/glass/divider/sill geometry, construction-opening dimensions, an instance mark, a plan tag, and a basic window schedule. Its main limitation is not basic geometry. It lacks the reusable type system, composable window assembly, host-layer closure, detail-level documentation, performance data, and IFC round-trip expected of a BIM window.

## Current repository audit

Pascal's [`WindowNode`](../../packages/core/src/schema/nodes/window.ts) is substantially more capable than a generic component. It currently stores:

- ten form/operation choices: fixed, sliding, casement, awning, hopper, single-hung, double-hung, bay, bow, and louvered;
- rectangular, individually rounded, and arched opening profiles;
- single/French casement configuration, hinge side, awning direction, and a persisted open-state value;
- overall width/height, frame thickness/depth, unequal column and row ratios, divider thicknesses, and sill geometry;
- frame and glass material slots;
- wall, dormer-face, and roof-generated-wall-face host references;
- nominal, rough, masonry, and finish-opening dimension references; and
- an instance mark plus an opening-only mode that creates a shaped wall cut without window geometry.

The registered [`windowDefinition`](../../packages/nodes/src/window/definition.ts) adds host-aware placement and movement, bounded width/height handles, side flipping, floor-plan affordances, material painting, roof-wall cuts, and contextual dimensions. Placement prevents overlap with sibling openings unless explicitly forced, and resizing clamps to the available wall or sloped dormer/roof-wall face. The wall system uses the window profile for a real CSG cutout rather than drawing a decal.

The 3D system is also unusually rich for an early architectural editor. It builds procedural geometry for every listed type and directly animates sliding panels, single/double-hung sashes, casements, awning/hopper sashes, and louver blades. Bay and bow windows have generated projecting geometry. Progressive rebuild limits prevent a large dirty set from monopolizing a frame.

Pascal already has a credible first documentation layer. [`opening-documentation.ts`](../../packages/nodes/src/shared/opening-documentation.ts) generates stable marks, warns about duplicate explicit marks, resolves the selected nominal/rough/masonry/finish dimensions without inventing missing values, adds plan tags, and produces a window schedule containing mark, type, nominal size, rough opening, sill, head, and operation.

### Current limitations visible in the implementation

| Area | Current implementation | Limitation |
|---|---|---|
| Reuse | Every window instance owns all geometry and material parameters | No shared family/style definition, standard-size catalog, or global type update |
| Type model | `windowType` is one enum combining broad form and operation | No independent product family, configuration, panel operation, or type-vs-instance ownership |
| Assembly | Procedural frame, glass, dividers, and one sill | No sash/leaf component graph, stops, liners, jamb/head members, casing, trim, screens, hardware, flashing, or custom nested components |
| Glazing | One generic glass slot | No pane count, thickness, laminate/coating, gas fill, spacer, glazing system, or separate panel materials |
| Panel layout | Unequal row/column ratios are editable for fixed windows | Operable types use mostly hard-coded sash layouts; panels cannot each have their own operation and construction |
| Bay/bow | Generated geometry exists | Projection depth, angles/radius, panel count, seat/head construction, and panel operations are hard-coded rather than authored parameters |
| Host integration | Wall/dormer/roof-wall hosting, orientation, clamping, and CSG cut | No compound-wall jamb/head/sill closure, wrapping, reveal construction, tolerance rules, curtain-wall panel host, true roof-window/skylight host, or corner-window relationship |
| 2D output | Generic plan footprint, inner outline, center line, mark, and resize handles | The source explicitly omits actual rounded/arched profiles and multi-pane grids; no operation-specific plan symbol, elevation, section, reflected-plan, or detail-level representation |
| Documentation | Instance mark and basic window schedule | No type mark, manufacturer/model/specification/keynote, room association, elevation callout, material quantities, operable area, or type-grouped performance schedule |
| Performance | No dedicated schema fields found | Missing U-factor, SHGC, visible transmittance, air leakage, acoustic/fire/security ratings, glazing makeup, and natural-ventilation data |
| IFC | Import recovers host, width, height, position/sill and source identifiers; operation may remain metadata | No native IFC type, predefined operation, lining/panel properties, material/property sets, classification, quantity, or export round-trip |
| Validation | UI and drag handles impose practical limits | Core width/height and row/column ratio schemas do not fully encode positivity, non-empty arrays, normalized ratios, or component compatibility |

This means Pascal is already ahead of native SketchUp and Rhino in semantic hosting, opening behavior, operation animation, and automatic documentation. Relative to Revit, AutoCAD Architecture, VisualARQ, and Archicad, the largest gap is the **reusable construction definition behind each instance**, followed by host-wall detailing and performance/interoperability—not the number of primitive window shapes.

## Product findings

### Revit

- A window is a loadable family selected by type, with wall hosting, orientation flips, host reassignment, sill/head placement, and instance properties. Windows are hosted in walls; the same tool can place skylights from appropriate families in in-place roofs. [Revit windows](https://help.autodesk.com/cloudhelp/2027/ENU/Revit-ArchDesign/files/GUID-987D9F47-E4C7-4213-8ABE-F61D8CC56D6A.htm)
- Type changes propagate to every instance. Standard type data includes width, height, default sill height, inset, rough-opening dimensions, sash and glazing materials, construction type, wall-layer closure, manufacturer/model/cost, classification, type mark, IFC operation, analytic construction, and heat-transfer coefficient. [Window type properties](https://help.autodesk.com/cloudhelp/2026/ENU/Revit-ArchDesign/files/GUID-1C03B7DF-89EE-48B1-B501-571745B1D513.htm)
- Family metadata can be type- or instance-based, extended with custom parameters, and included in schedules. [Family metadata parameters](https://help.autodesk.com/cloudhelp/2026/ENU/Revit-Customize/files/GUID-71AEB242-F699-4855-B05A-B37D6B5D7DF2.htm)
- Tags normally expose a window Type Mark. Rough dimensions and identity data can be scheduled or exported. Revit also provides configurable IFC class/type and property export mapping. [Revit IFC export](https://help.autodesk.com/cloudhelp/2026/ENU/RevitLT-DocumentPresent/files/GUID-6EB68CEC-6C17-4B16-A509-30537F666C1F.htm)

**What this establishes:** mature type/instance separation, parametric family authoring, wall-layer-aware openings, standardized documentation, performance properties, and explicit IFC semantics.

### AutoCAD Architecture

- Every window uses a window style. Styles control dimensions, standard sizes, shape, and operation; editing a style updates its windows globally, while object-level properties can still override an individual instance. [Window styles](https://help.autodesk.com/cloudhelp/2025/ENU/AutoCAD-Architecture/files/GUID-9599749E-6A0C-46A5-A942-6C06B28289A6.htm)
- A style may use predefined or custom-profile shapes and operations such as casement or hopper. Placement tools define standard/custom size, inside/outside frame measurement, rise, opening percentage or swing, along-wall position, head height, and sill height. [Window design rules](https://help.autodesk.com/cloudhelp/2026/ENU/AutoCAD-Architecture/files/GUID-B1945289-7201-467F-B746-57D88F84C2DE.htm), [window tools](https://help.autodesk.com/cloudhelp/2026/ENU/AutoCAD-Architecture/files/GUID-A4358DD1-8FB7-47C4-82C7-8262C2A2449E.htm)
- Muntins, component materials, and view-specific model/plan/elevation representations are style-controlled. For larger compositions, door/window assemblies provide nested grids, cells, panels, frames, mullions, and inserted windows or doors. [Door/window assemblies](https://help.autodesk.com/cloudhelp/2026/ENU/AutoCAD-Architecture/files/GUID-30E2A814-64AC-4BE3-88C5-8A8275F9CB02.htm)
- Property sets attach typed or custom data to styles and objects. Schedule tables extract that data, update with model changes, allow manual fields, and can be exported. [Property sets](https://help.autodesk.com/cloudhelp/2026/ENU/AutoCAD-Architecture/files/GUID-C7BD8A5D-899E-4166-BC53-768C9AD2F2DE.htm), [schedule tables](https://help.autodesk.com/cloudhelp/2026/ENU/AutoCAD-Architecture/files/GUID-52325092-A648-4B6A-9B7B-2343228ECD26.htm)
- IFC export is built in. IFC attributes without direct native mappings can be preserved through supplied property-set definitions. [IFC export](https://help.autodesk.com/cloudhelp/2026/ENU/AutoCAD-Architecture/files/GUID-4636802F-2752-408C-A08F-148A83FAE005.htm), [IFC property-set mapping](https://help.autodesk.com/cloudhelp/2026/CHT/AutoCAD-Architecture/files/GUID-436DB646-A4B9-4B3B-A0EE-15AA6D7D473E.htm)

**What this establishes:** reusable office-standard styles, richer placement rules, custom profiles, complex multi-panel assemblies, display-by-view, and property-driven schedules.

### SketchUp

- Native SketchUp has no dedicated architectural window object. A window is normally reusable component geometry. A component definition controls shared geometry and behavior; transformations can vary by instance, and an instance can be made unique. [SketchUp components](https://help.sketchup.com/en/sketchup/components)
- A component can glue to a vertical or sloped face and cut one opening in that face. It can carry price, size, URL, custom attributes, and an IFC classification. This is face-based behavior rather than a BIM host relationship with wall layers, reveals, or closure rules. [Creating a component](https://help.sketchup.com/en/sketchup/creating-basic-component)
- Dynamic and Live Components add configurable dimensions, materials, formulas, options, and interactions, but they remain generic configurable components rather than a standard window schema. [Dynamic-component attributes](https://help.sketchup.com/en/sketchup/dynamic-component-predefined-attributes), [Live Components](https://help.sketchup.com/en/sketchup-live-components)
- Classified component attributes can be reported to CSV and passed into LayOut tables. SketchUp imports and exports IFC classification data, but authoring quality depends on the component creator. [Attribute reports](https://help.sketchup.com/en/sketchup/generating-attribute-report), [IFC import/export](https://help.sketchup.com/en/importing-and-exporting-ifc-files)

**What this establishes:** Pascal is already more semantically architectural than native SketchUp. SketchUp's advantage is unrestricted component geometry and a large reusable-content workflow, not built-in BIM window intelligence.

### Rhino and VisualARQ

- Native Rhino likewise has no semantic window. Blocks provide reusable definitions, linked libraries, nested geometry, per-instance transforms, counts, materials, and user text, but no automatic architectural host or opening contract. [Rhino blocks](https://docs.mcneel.com/rhino/8/help/en-us/commands/block.htm), [attribute user text](https://docs.mcneel.com/rhino/8/help/en-us/properties/attributeusertext.htm)
- VisualARQ adds BIM window styles. A style defines opening type and profile, predefined sizes, frame, stop, one or more leaves, glass, muntins, handles, sill, component materials, custom parameters, and optional custom 2D/3D blocks. Styles can also be driven by Grasshopper. [VisualARQ window styles](https://help.visualarq.com/architectural-objects/window/window-styles/)
- VisualARQ windows can be hosted by walls, curtain walls, slabs, and roofs, or remain floating. Hosted openings update with the object and can orient to sloped hosts. [VisualARQ architectural objects](https://www.visualarq.com/feature/architectural-objects/)
- Documentation includes tags and property-driven table styles with grouping and quantity fields. The IFC translator maps windows as `IfcWindow` and exports object/custom properties. [VisualARQ table tools](https://help.visualarq.com/interface/toolbars/), [IFC translator](https://help.visualarq.com/visualarq-tools/ifc-translator/)

**What this establishes:** Rhino supplies free-form geometry; VisualARQ supplies the reusable style, host relationship, components, documentation, Grasshopper extensibility, and IFC layer needed for BIM.

### Archicad

- Windows are parameterized library parts placed into walls. They create true openings; separate tools cover skylights and corner windows. Settings include wall anchoring, sill/header position, reveal, orientation in complex or slanted walls, and curved-wall placement. [Archicad doors/windows](https://help.graphisoft.com/AC/29/INT/_AC29_Help/040_ElementsVB/040_ElementsVB-305.htm)
- Library windows expose extensive component settings: nominal size/tolerance, shape, opening type and angle, frame and sash, grids, reveal, inset, wall opening, wall closure, masonry arch, sill, casing, fixtures, sunshade, minimum clear space, and detail level. [Door/window settings](https://help.graphisoft.com/AC/29/INT/_AC29_Help/151_DoorWindowCustomSettings/151_DoorWindowCustomSettings-1.htm)
- Composite-wall closure can turn selected wall skins into the opening and add insulation or plaster returns. Floor-plan/section symbols have dedicated view controls instead of simply projecting the 3D model. [Wall closure](https://help.graphisoft.com/AC/29/INT/_AC29_Help/151_DoorWindowCustomSettings/151_DoorWindowCustomSettings-17.htm), [2D representation](https://help.graphisoft.com/AC/29/INT/_AC29_Help/151_DoorWindowCustomSettings/151_DoorWindowCustomSettings-29.htm)
- Library-part and IFC properties can be used directly as Interactive Schedule fields. Energy Evaluation works with space boundaries and U/R-value data; IFC export can include classifications, properties, quantities, space boundaries, and detailed door/window lining and panel properties. [Schedule fields](https://help.graphisoft.com/AC/29/INT/_AC29_Help/055_InteractiveSchedule/055_InteractiveSchedule-10.htm), [IFC data conversion](https://help.graphisoft.com/AC/29/INT/_AC29_Help/121_IFC/121_IFC-42.htm)

**What this establishes:** deep host-wall integration, detailed construction/reveal modeling, purpose-built 2D documentation, schedule access to arbitrary parameters, energy-model participation, and rich IFC export.

## Capability comparison

| Capability | Revit | AutoCAD Architecture | SketchUp | Rhino | VisualARQ | Archicad |
|---|---|---|---|---|---|---|
| Reusable window definition | Family/type | Style | Component definition | Block definition | Window style | Library part/favorite |
| Per-instance overrides | Strong | Strong | Transform/unique definition | Transform/user text | Strong | Strong |
| Semantic host opening | Wall/roof-family dependent | Wall anchor | Face glue/cut | No | Wall, curtain wall, roof, slab | Wall; separate skylight |
| Componentized frame/glazing | Family-authored | Style + assemblies | Arbitrary manual geometry | Arbitrary manual geometry | Built-in components | Extensive library parameters |
| Wall-layer closure/reveal | Yes | Endcap/display system | No | No | Host-aware opening; wall wrapping system | Extensive |
| Tags and schedules | Native | Native | Attribute report + LayOut | Manual/generic | Native tables/tags | Native Interactive Schedules |
| Thermal/performance data | Native U-value/analytic fields | Extensible property sets | Custom attributes | User text only | Custom parameters/IFC properties | Energy Evaluation + IFC space boundaries |
| IFC window semantics | Native mapped export | Native export + property sets | Classification-based | Requires extension/workflow | `IfcWindow` + properties | Rich translator and panel/lining data |

## Major capability implications for Pascal

### Priority 0: establish the BIM data model

1. **Introduce a reusable `WindowStyle` or `WindowFamilyDefinition` distinct from `WindowNode`.** The name should not collide with Pascal's current `WindowType` enum, which is really a form/operation choice. Shared type data should include operation, opening/profile shape, nominal and rough size rules, frame/sash/glazing construction, standard sizes, materials, manufacturer/classification, performance, and IFC mapping. Instances should keep host, position, sill/head, orientation, mark, and explicit overrides.
2. **Replace the mostly fixed procedural window with a composable assembly.** Support multiple fixed/operable panels, unequal bays, transoms, nested rows/columns, per-panel operation, mullions, muntins, frame members, glazing units, stops, sills, trims, screens, hardware, and optional custom components.
3. **Define a real host-opening contract.** The window should own rough, masonry, and finish openings; reveal/inset; interior/exterior orientation; jamb/head/sill closure; wall-layer wrapping; tolerance; and behavior when the host changes thickness, type, curve, slope, or direction.

### Priority 1: make windows documentable and analyzable

4. **Extend construction-document identity.** Keep the existing instance marks, plan tags, and basic schedule, but distinguish type mark from instance mark and add elevation symbols, handing/facing, manufacturer/model, specification/keynote, classification, cost, phase, and renovation status.
5. **Add purpose-built 2D and detail-level representations.** Correct the current generic plan symbol first, then add reflected plan, elevation, section, coarse/medium/fine views, opening direction, overhead/hidden lines, cut fills, and scalable symbols that do not depend solely on projected 3D geometry.
6. **Add performance properties.** At minimum: U-value, solar heat-gain coefficient, visible transmittance, air leakage/infiltration, acoustic rating, fire rating where applicable, glazing makeup, operable area, and natural-ventilation behavior.
7. **Extend model-derived quantities and schedules.** Build on the current window schedule with counts and grouping by type/size, frame/glass areas, operable area, orientation, room association, materials, and performance values, plus CSV/table output.

### Priority 2: interoperability and advanced authoring

8. **Round-trip IFC windows.** Preserve stable IDs, `IfcWindow` and type/predefined operation, classifications, `Pset_WindowCommon`, lining and panel properties, materials, quantities, host/opening relationships, custom property sets, and instance-vs-type ownership.
9. **Provide a family/style authoring path.** Start with a constrained panel-layout editor; later allow custom 2D/3D representations or a graph/script-driven definition comparable to Revit families, Archicad GDL, SketchUp Live Components, or VisualARQ Grasshopper styles.
10. **Cover specialist hosts and forms.** Corner windows, ribbon windows, bay/bow windows, curtain-wall inserts, roof windows/skylights, sloped hosts, custom-profile openings, and floating openings should build on the same host/opening interface rather than separate one-off schemas.

## Recommended sequence

1. Introduce a reusable `WindowStyle`/`WindowFamilyDefinition` plus explicit instance overrides, and migrate current procedural fields into it without confusing it with the existing `WindowType` operation enum.
2. Add panel-grid/component schemas and a standard-size catalog.
3. Formalize host orientation, reveals, rough/finish openings, and wall-layer closure.
4. Extend the current tags and schedule with type/instance marks, grouping/quantities, and view-specific 2D symbols.
5. Add performance and classification fields.
6. Implement full IFC type/property/host round-trip.
7. Add custom family authoring and specialist window forms.

This sequence keeps Pascal's existing host-aware procedural strengths while moving first on the shared foundation required by documentation, performance analysis, libraries, and interoperability.
