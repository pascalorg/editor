# Stair modeling research

Research date: 2026-10-05. Reference approaches to stair geometry, authoring and semantic export.

## What established tools do

**Solve dimensions together.** Revit's calculator takes minimum tread depth, maximum riser height, and a rise/tread relationship. Pascal should offer a sizing solver, actual riser/going readouts, and explicit locked inputs. A comfort relationship is a design target, not universal code compliance. [Autodesk stair calculator](https://help.autodesk.com/cloudhelp/2022/ENU/RevitLT-ArchDes/files/GUID-4E763B5A-1FFF-4084-BFAC-B587FEB01B3D.htm), [Autodesk dimension editing](https://help.autodesk.com/cloudhelp/2025/ENU/RevitLT-ArchDes/files/GUID-7EA40FA9-3128-45B2-B794-8E33036E9D9B.htm).

**Separate layout from construction and annotation.** Revit distinguishes stair, run, landing, support, path, and tread/riser numbering properties. Pascal's existing graph is a useful starting point, but geometry and annotation should consume the same resolved data. [Autodesk stair properties](https://help.autodesk.com/cloudhelp/2026/ENU/Revit-ArchDesign/files/GUID-7EBB3572-176C-4AC4-A841-48CCA7E742F5.htm).

**Offer alternatives when a design does not fit.** Archicad's Stair Solver presents alternative arrangements when a stair conflicts with constraints. Pascal can start with a few deterministic straight/L/U candidates and explain which dimension must change. [Graphisoft Stair Tool](https://helpcenter.graphisoft.com/user-guide/76585/).

**Model the walking line and headroom explicitly.** Archicad distinguishes the boundary, baseline, and walking line, and provides headroom settings with vertical or perpendicular measurement. Pascal should label its current curved tread measure as centerline going and make the actual measurement line an explicit rule when checking winders or spirals. [Graphisoft graphical editing](https://help.graphisoft.com/AC/28/INT/_AC28_Help/040_ElementsVB/040_ElementsVB-180.htm), [Graphisoft rules and standards](https://helpcenter.graphisoft.com/user-guide/88684/).

**Keep quantities semantic.** IFC provides separate tread and riser quantities. Pascal currently uses `stepCount` as both the visible-step concept and the riser-count annotation. Define start/end conditions before changing the persisted convention; do not simply subtract one tread from all existing scenes. [buildingSMART NumberOfTreads](https://ifc43-docs.standards.buildingsmart.org/IFC/RELEASE/IFC4x3/HTML/property/NumberOfTreads.htm).

Revit explicitly supports beginning and ending a run with a riser. This is why riser count and manufactured tread count need distinct meanings. Its spiral tool also supports sweeps beyond one revolution. [Autodesk run instance properties](https://help.autodesk.com/cloudhelp/2021/ENU/Revit-ArchDesign/files/GUID-22EC1748-A525-43BB-A45E-97D104CF303B.htm), [Autodesk full-step spiral](https://help.autodesk.com/cloudhelp/2020/ENU/Revit-Model/files/GUID-F521015D-1703-48EA-847D-184E6C277BDB.htm).

**Use construction parameters without moving the walking surface.** FreeCAD's stair source exposes tread/riser thickness, nosing, enforced versus derived dimensions, and outlines for railings. Archicad supports monolithic, beam, cantilevered, and stringer structures. These are references for a useful construction vocabulary, rather than a reason to implement all variants at once. [FreeCAD ArchStairs source](https://github.com/FreeCAD/FreeCAD/blob/main/src/Mod/BIM/ArchStairs.py), [Graphisoft stair structures](https://helpcenter.graphisoft.com/user-guide/76598/).

IFC's common stair-flight properties include separate counts, riser height, going at a walking line, inner-side going, nosing, headroom, and waist thickness. The older flight entity attributes are deprecated; use the property set appropriate to Pascal's IFC4 export target. Landings belong to the slab class within the stair assembly. [buildingSMART flight definition](https://standards.buildingsmart.org/IFC/RELEASE/IFC4_3/HTML/lexical/IfcStairFlight.htm), [buildingSMART flight properties](https://standards.buildingsmart.org/IFC/RELEASE/IFC4_3/HTML/lexical/Pset_StairFlightCommon.htm), [buildingSMART stair decomposition](https://standards.buildingsmart.org/IFC/RELEASE/IFC4_3/HTML/lexical/IfcStair.htm).

For turning stairs, equal-angle wedges and equal-going winders are different designs. The latter requires solving tread boundaries against the walking line; it cannot be obtained merely by rotating the existing rectangular flights. Model the walking-line division explicitly. [Graphisoft turning types](https://help.graphisoft.com/AC/29/INT/_AC29_Help/040_ElementsVB/040_ElementsVB-181.htm).


Design targets are adjustable guidance, not jurisdiction-specific compliance certification.
