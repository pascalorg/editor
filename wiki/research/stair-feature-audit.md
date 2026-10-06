# Stair feature audit — 2026-10-06

Current-source audit of stair/segment schemas, inspector, railing controls, construction settings, clearance queries and plan documentation. Model refinement status: balusters, post-and-rail, cable and boards independently approved; glass in progress; metal pending.

Already present: straight/L/U landing and winder layouts, equal-going/equal-angle winders, curved and signed multi-turn spiral stairs, integrated spiral landings, chained flights, source/destination levels/deck support, automatic openings, five construction modes, tread/riser/nosing/finish dimensions, uniform-riser sizing, walking line, measurements and diagnostics, six guard styles, independent handrail extensions/returns, paint slots, level-aware UP/DN documentation with dimensions and break marks, IFC/GLB/USDZ export.

| Priority | Gap | Improvement |
| --- | --- | --- |
| 1 | Original-layout selection silently changes glass/metal to balusters (`railing-controls.tsx`). Guard top-post/reach/through fields exist but are absent from the stair inspector. | Disable unavailable layout choices with a short explanation; preserve selected style. Put supported terminal controls in collapsed advanced railing settings. |
| 1 | Headroom query covers only slabs, ceilings and stair bodies (`stair-clearance.ts`). | Add roof/imported-body/beam obstruction adapters and visible collision highlights; report checked and unresolved coverage. |
| 1 | Design targets are four numbers, without use/jurisdiction/version metadata. Grip clearance, guard openings, nosing shape and wet-use checks are not a complete diagnostic system. | Add named editable use profiles, scoped rules and measured/unknown findings; never label generic targets universal compliance. |
| 2 | Guard member sections and post spacing are hard-coded; rail material is largely one slot. | Persist component parameters and separate glass/metal/wood slots, then expose concise advanced controls and per-side/per-flight overrides. Extend guards into adjacent opening/landing boundaries. |
| 2 | Handrail returns are geometry, not wall/post attachments; there is one independent handrail configuration. | Host-aware brackets/clearance, continuous transition fittings and an optional second handrail. |
| 2 | Each stair connects one source/destination pair. | Multi-storey assemblies with shared equal-height repetitions, independent exceptions and coordinated openings/guards. |
| 3 | Segment chain supports straight flights, landings and quarter-turn winders; curved/spiral is a stair-wide type. | Mixed straight/curved paths, custom landing outlines and variable-width flights; later branched/scissor/bifurcated layouts. |
| 3 | Construction settings describe bodies and dimensions, not engineered connections. | Explicit bearing/flight-landing joints, wall-mounted/cantilever supports, mounting plates and start/end cuts. |
| 3 | Plan break position is fixed at 0.68 of the run; no persisted stair numbering/cut-height settings were found in the stair schemas. | Editable cut plane, tread/riser numbering, hidden-above lines and annotation placement; retain existing UP/DN and dimensional labels. |
| 3 | Nosings have a projection dimension but no authored edge profile, dedicated contrast strip or wet-use intent. | Rounded/bevelled nosing profiles, slip/contrast finish slots and exterior drainage intent. |

Implementation order: finish glass and metal; fix silent style switching and expose supported advanced controls; improve obstruction coverage and scoped diagnostics; then component authoring and multi-storey stairs. Keep the main inspector compact, with model-dependent controls and advanced details collapsed.

External comparisons: [Autodesk stair components and custom runs/multistory stairs](https://help.autodesk.com/cloudhelp/2025/ENU/Revit-ArchDesign/files/GUID-B1B305DF-8DBE-44A7-A7C6-16B70A3B580E.htm), [Graphisoft component editing](https://helpcenter.graphisoft.com/user-guide/76585/), [Graphisoft plan settings](https://helpcenter.graphisoft.com/user-guide/128203/), [Access Board stair/handrail guidance](https://www.access-board.gov/ada/guides/chapter-5-stairways/). The Access Board source is scoped US accessibility guidance, not a universal rule set. Fabrication quantities and structural certification were not audited here.
