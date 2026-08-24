# Modular kitchen cabinets: construction and planning research

Research completed 2026-08-24. This note turns first-party cabinet-system, kitchen-planning, accessibility, quality, and material sources into design constraints for Pascal's modular kitchen cabinets. Dimensions are given in both imperial and metric where the source provides them.

## Executive conclusion

There is no single worldwide “standard cabinet.” A modular system is a *dimension family*: a small set of repeatable widths, depths, heights, fronts, fillers, end panels, plinths, and hardware boring patterns. A good planner keeps the family consistent, but allows height/depth adjustments for the room, user, appliances, and local construction practice.

The most important product rule is to separate three layers:

1. **Module geometry** — carcass, shelves, drawers, doors, appliance openings, toe kick/plinth, and finished ends.
2. **Run geometry** — alignment, fillers, corners, shared countertop, backsplash, plinth, island overhang, and tall-unit composition.
3. **Planning constraints** — circulation, landing areas, work zones, appliance manufacturer clearances, accessibility, services, and finish coordination.

The “looks good” result comes primarily from consistent datums and reveals: cabinet fronts should align into intentional horizontal and vertical lines; fillers should absorb irregular room dimensions; tall units and appliances should be composed as architectural masses; and the material palette should be limited and repeated deliberately. Appearance cannot compensate for a door collision, missing landing area, unusable corner, or unventilated appliance.

## What the sources actually standardize

### Common dimension families

| System / convention | Common dimensions | How to use it |
| --- | --- | --- |
| US-style framed/frameless catalog example | KraftMaid describes a 34.5 in (876 mm) base cabinet, usually paired with a 1.5 in (38 mm) countertop for a 36 in (914 mm) finished worktop. Base depth is commonly 24 in (610 mm); widths start at 6 in and commonly increase in 3 in increments to 48 in. Tall pantry depths are 12 or 24 in and heights start at 84 in, increasing in 3 in increments to 96 in. | Treat these as a North American preset family, not universal truths. [KraftMaid cabinet sizes](https://www.kraftmaid.com/kraftmaid/kitchen-cabinet-sizes) |
| IKEA METOD metric family | Base frame H80 cm; base depths D37 or D60 cm; widths W20, 30, 40, 60, 80 cm. Wall units use D37 cm and H40/60/80/100 cm options. Tall units include H140/200/220 cm and D60 cm options. METOD's published frame overview explicitly lists these combinations. | A clean metric preset for the planner. Keep the system's width/depth/height combinations explicit instead of allowing arbitrary values by default. [IKEA METOD cabinet guide](https://www.ikea.com/gb/en/files/pdf/f8/4f/f84f4466/metod-cabinets-guide.pdf) |
| METOD finished installation | IKEA publishes roughly 91–92 cm finished base height with an 80.2 cm frame, 8 cm legs, and a 2.8 or 3.8 cm worktop; it also describes a typical 36.6 cm wall frame depth and roughly 38–40 cm complete wall-unit depth. | Useful for metric ergonomics, but make legs, plinth, and worktop thickness independently configurable. [IKEA base height and wall depth](https://www.ikea.com/pl/pl/customer-service/knowledge/articles/17f088fe-4246-43g5-8831-7ggf7d55dgg5.html) |
| METOD internal capacity | Published internal widths are 16.4/26.4/36.4/56.4/76.4 cm for 20/30/40/60/80 cm frames; internal depths are 35 cm for D37 and 58 cm for D60. | Geometry and storage calculations must distinguish nominal outside size from clear internal size. [IKEA internal frame dimensions](https://www.ikea.com/se/en/customer-service/knowledge/articles/5g03d6cb-4ed3-4g4c-bd6d-52033730g335.html) |

Do not silently convert between families. A 600 mm module, a 24 in module, and an appliance advertised as 60 cm may differ after side panels, fillers, ventilation gaps, and door overlays. Appliance installation documentation wins over a generic cabinet preset.

### Construction and durability

A useful construction abstraction is a rigid box plus replaceable/adjustable components: two sides, bottom, back, top rails or top, shelves, front(s), hardware, and a mounting system. Frameless and face-frame cabinetry are both valid; they change opening dimensions, overlay/reveal behavior, and hardware placement. The box must remain square and rigid even when a sink, oven, refrigerator, or removable back interrupts the normal carcass.

For North American quality benchmarking, KCMA's current A161.1-2022 document covers general construction, shelf/bottom loading, mounted wall-cabinet loading, door and hinge operation, drawer operation, finish appearance, and finish resistance to heat, chemicals, detergent, water, and related stresses. [KCMA A161.1-2022 standard](https://kcma.org/sites/default/files/2024-08/KCMA%20A161.1%202022%20High%20Res.pdf) KCMA describes certification as third-party testing of structure, doors, drawers, and finish; examples include 600 lb wall-cabinet loading and 25,000 door/drawer cycles. [KCMA certification overview](https://kcma.org/certifications/kcma-quality-cabinet-certification2)

Implementation implications:

- Keep carcass dimensions and front dimensions separate. A change in overlay, reveal, or front thickness must not mutate the structural module.
- Model clear opening and service voids explicitly for appliances, plumbing, electrical, ventilation, and sink bowls.
- Make shelves adjustable by default where the module allows it; use pull-outs or drawers where deep shelves would hide contents.
- Provide a mounting datum/rail and leveling state for wall units. IKEA specifically recommends suspension rails because they make alignment easier. [METOD cabinet guide](https://www.ikea.com/gb/en/files/pdf/f8/4f/f84f4466/metod-cabinets-guide.pdf)
- Use tolerance-aware alignment: runs need a small, consistent reveal/gap and a way to absorb wall error with fillers and finished ends.
- Treat hardware as a first-class constraint. Blum's configurator performs collision checking, computes front weight, supports standard dimensions, and produces cutting/manufacturing data; this is a strong model for a parametric planner. [Blum Cabinet Configurator](https://www.blum.com/in/en/services/planning-construction-product-selection/cabinet-configurator/)

## Placement rules that make a kitchen work

NKBA's guideline documents are recommendations, not a substitute for local building code or appliance instructions. They are especially useful as planner warnings and defaults.

### Circulation and work aisles

- A general walkway should be at least 36 in (914 mm). When two walkways intersect perpendicularly, NKBA's access recommendation is at least 42 in (1067 mm) for one walkway. [NKBA Guideline 7](https://kb.nkba.org/uploads/2022/05/Kitchen-Planning-Guidelines.pdf)
- The NKBA scoring material identifies 42 in as the minimum work aisle for a one-cook kitchen and 48 in for more than one cook; it also checks that the work triangle is at most 26 ft total, with each leg 4–9 ft, and that traffic does not cross the triangle. [NKBA CKBD score sheet](https://kb.nkba.org/wp-content/uploads/2018/05/Grand-Kitchen-Scoresheet.pdf)
- A work aisle is different from a circulation walkway: measure from the furthest projecting cabinet, counter, or appliance face, and account for open doors/drawers. A planner should preview open-door states, not only closed cabinet rectangles.
- In seating areas, allow at least 32 in from counter/table edge to the obstruction behind a seated diner when no traffic passes behind; increase clearance when the area is also a passage. [NKBA Guideline 8](https://kb.nkba.org/uploads/2022/05/Kitchen-Planning-Guidelines.pdf)

### Activity zones and landing areas

Use zones (arrival/storage, refrigeration, preparation, cooking, cleanup, serving) as the primary mental model. The work triangle remains a useful collision/efficiency check, but a long kitchen or multi-cook kitchen should not be forced into one literal triangle. NKBA's own material describes both the triangle and activity-center guidance, and its examples emphasize clear traffic and landing spaces. [NKBA planning overview](https://kb.nkba.org/kitchen-bath-planning-guidelines/), [NKBA design examples](https://kb.nkba.org/2013/04/2012-nkba-ge-charette/)

Useful defaults:

- Provide a continuous preparation surface of at least 36 in W × 24 in D (914 × 610 mm) immediately next to the primary sink. [NKBA Guideline 12](https://kb.nkba.org/uploads/2022/05/Kitchen-Planning-Guidelines.pdf)
- Put the nearest edge of the dishwasher within 36 in (914 mm) of the nearest edge of the cleanup/prep sink, and reserve at least 21 in (533 mm) of standing space at the dishwasher. [NKBA Guideline 13](https://kb.nkba.org/uploads/2022/05/Kitchen-Planning-Guidelines.pdf)
- Give a cooking surface at least 12 in (305 mm) of landing on one side and 15 in (381 mm) on the other. In an island/peninsula with the same-height counter behind the cooktop, NKBA recommends at least 9 in (229 mm) of rear counter overhang. [NKBA Guideline 17](https://kb.nkba.org/uploads/2022/05/Kitchen-Planning-Guidelines.pdf)
- Give the refrigerator at least 15 in (381 mm) of landing on its handle side, on either side of a side-by-side refrigerator, or across from/above an undercounter unit; NKBA limits the across-the-way landing distance to 48 in (1219 mm). [NKBA Guideline 16](https://kb.nkba.org/uploads/2022/05/Kitchen-Planning-Guidelines.pdf)
- Check that appliance and cabinet doors do not collide with each other, walls, entries, or the work aisle. This is a core design validation, not a cosmetic detail.

### Seating and islands

For each diner, NKBA recommends approximately 24 in (610 mm) of width. Knee-space depth depends on counter height: 18 in at a 30 in table, 15 in at a 36 in counter, and 12 in at a 42 in counter. [NKBA Guideline 9](https://kb.nkba.org/uploads/2022/05/Kitchen-Planning-Guidelines.pdf)

In the data model, an island should therefore expose counter height, seating side, seat count, per-seat width, knee clearance, and traffic clearance. Do not treat a rear overhang as an arbitrary visual extrusion: it changes the required aisle and collision envelope.

## Accessibility and universal design

ADA requirements apply to covered facilities and particular residential situations; they are not a universal residential cabinet-size rule. They are nevertheless excellent guardrails for inclusive defaults.

The US Access Board's 2010 standards specify: pass-through kitchen clearance of at least 40 in (1015 mm), U-shaped kitchen clearance of at least 60 in (1525 mm), at least one 30 in (760 mm) wide work surface in covered dwelling units, a maximum work-surface height of 34 in (865 mm), and at least 50% of storage shelf space within the applicable reach range. Appliance clear floor spaces must be provided; an open dishwasher door must not block the sink or dishwasher clear space; cooktop controls must not require reaching across burners. [US Access Board, Kitchens and Kitchenettes](https://www.access-board.gov/ada/chapter/ch08/), [ADA.gov 2010 Standards](https://www.ada.gov/law-and-regs/design-standards/2010-stds/)

Universal-design defaults worth supporting as options:

- One lower or adjustable prep surface, rather than forcing the entire kitchen to one height.
- Drawers and full-extension pull-outs for heavy or frequently used items.
- A removable sink base and finished floor beneath an adaptable work surface.
- Reach-range warnings for wall cabinets and high pantry shelves.
- Controls and handles that can be operated without a tight pinch or a long reach.

The NKBA's accessible-storage example recommends keeping commonly used storage roughly 18–48 in (457–1219 mm) above the floor and using pull-outs/pull-downs to bring contents into reach. [NKBA accessible storage example](https://kb.nkba.org/2019/07/pull-out-pull-down-go-deep/)

## Appearance, color, and material defaults

There is no authoritative “correct kitchen color.” Color should follow the room, light, architecture, client preference, and the selected material's maintenance behavior. A modular product should therefore ship with a restrained palette and allow variation without breaking alignment.

Recommended product defaults (design heuristics, not standards):

- **Base palette:** warm white, soft neutral gray, and a natural light/mid wood; keep carcass interiors light enough to see contents.
- **Contrast:** use one primary front color/material, one countertop/backsplash family, and one hardware/accent finish. A second front color should be an explicit two-tone option, not an accidental per-module choice.
- **Small kitchens:** favor lighter fronts, glass/open display only where appropriate, and avoid covering every wall with dark material. NKBA notes that light-colored cabinets, open shelving, and glass fronts can make a small room feel larger, while too many dark cabinets can make it feel smaller. [NKBA small-kitchen guidance](https://kb.nkba.org/2012/10/making-small-kitchen-space/)
- **Visual rhythm:** align drawer rails and door reveals across adjacent modules; repeat the same front style, edge profile, handle family, and reveal width across a run; use fillers at walls and corners rather than shrinking every module to fit.
- **Composition:** group tall cabinets/appliance towers; center the hood/cooktop or make an intentional offset; balance asymmetry with a deliberate open shelf, finished panel, or accent block. Avoid isolated 100–150 mm sliver cabinets unless they have a real function (tray, spice, filler, or pull-out).
- **Lighting:** model under-cabinet/task lighting as part of the kitchen composition. NKBA safety guidance recommends general lighting supplemented by focused task lighting without glare or shadows on work surfaces. [NKBA kitchen safety guidance](https://kb.nkba.org/2012/10/steps-safe-kitchen/)

Material defaults should expose performance metadata, not only a swatch. For US-sold products containing MDF, particleboard, or hardwood plywood, EPA TSCA Title VI requires regulated composite wood and finished goods containing it to be certified/labeled; the rule includes third-party certification and recordkeeping. [EPA composite-wood formaldehyde requirements](https://www.epa.gov/formaldehyde/formaldehyde-emission-standards-composite-wood-products), [EPA consumer FAQ](https://www.epa.gov/formaldehyde/frequent-questions-consumers-about-formaldehyde-standards-composite-wood-products-act)

For material selection, expose at least: front finish (paint, wood veneer, laminate, glass), carcass finish, countertop material, edge band, hardware finish, water/heat/chemical resistance, maintenance notes, and regional compliance labels. KCMA's ESP is a cabinet-specific environmental certification covering documented manufacturing and resource practices; it can be used as a sustainability signal but is not a substitute for local requirements. [KCMA ESP](https://kcma.org/environmental-standard-cabinetry)

## How an architect or kitchen designer typically reasons

The professional workflow is constraint-first and iterative:

1. **Brief the household.** Who cooks, how many cooks, handedness, height, accessibility needs, meal patterns, entertaining, children, cleaning/recycling, small appliances, and desired visual character.
2. **Survey the room.** Record finished dimensions, out-of-square walls, windows/doors and swings, ceiling height, floor level, structure, plumbing, electrical, gas, ventilation route, radiators, and required clearances. IKEA's measuring guidance explicitly calls out room dimensions, corners, doors, plumbing, and related site details before planning. [IKEA measuring service](https://www.ikea.com/gb/en/customer-service/services/kitchen-measuring/)
3. **Lock the appliance set early.** Record exact model installation sheets, opening dimensions, ventilation, power, water, drainage, and door-swing requirements. Place the refrigerator, sink, dishwasher, and cooktop as activity centers, then add landing/work surfaces.
4. **Choose a cabinet family.** Select metric or imperial module widths, base/wall/tall heights, depth families, plinth/leg height, front/overlay style, and hardware system before filling the run.
5. **Draft plan and elevations.** Validate walkways, work aisles, triangles/zones, seating, landing areas, corners, open-door collisions, and service access. Then inspect elevations for consistent datums, reveals, tall-unit groupings, appliance alignment, and end treatments.
6. **Develop materials and lighting.** Limit the palette, test it against daylight and artificial light, specify durable cleanable surfaces, coordinate backsplash, countertop, handles, task lighting, and appliance finishes.
7. **Coordinate and document.** Produce plan, elevations, sections, module schedule, cut/filler list, appliance schedule, service plan, material schedule, and installation tolerances. A 3D preview is useful, but the dimensional schedule is the source of truth.
8. **Install and verify.** Level the run, anchor wall units to structure/rail, scribe fillers to walls, check reveals and door swings, seal wet areas, and verify appliance clearances and ventilation.

## Recommended Pascal cabinet rules

These are implementation recommendations derived from the sources above:

- Make the cabinet family explicit: nominal width, nominal depth, carcass height, plinth/leg height, worktop thickness, front thickness, overlay/reveal, and system unit (metric or imperial).
- Keep `module`, `run`, and `room-planning-constraint` separate. A run owns shared countertop, plinth, finished backs, fillers, and end panels; a module owns carcass/front/storage/appliance content.
- Store nominal outside dimensions and computed clear inside dimensions separately. Include side-panel, front, back, shelf, hardware, and service-void thicknesses in the calculation.
- Add semantic warnings for walkway/work-aisle width, sink prep area, dishwasher distance/standing space, refrigerator/cooktop landing, seating knee space, door collisions, corner reachability, appliance requirements, and accessibility options.
- Give each module a role (`base`, `wall`, `tall`, `corner`, `filler`, `open`, `sink`, `cooktop`, `oven`, `dishwasher`, `refrigerator`, `pantry`) and role-specific constraints rather than a single generic box with ad hoc flags.
- Make fillers and finished ends real modules in layout and rendering. They are what make a standardized catalog fit imperfect walls and look intentional.
- Use one shared front/reveal/handle/material definition at run or kitchen scope with per-module overrides only when intentional. This avoids accidental checkerboard colors and inconsistent gaps.
- Validate both closed and open states. A kitchen that looks correct in a top-down closed-box view can fail when a dishwasher, drawer, oven, refrigerator, or corner mechanism opens.
- Keep color and material presets replaceable and regional. Aesthetic defaults should be easy to change; safety, accessibility, structural, and appliance constraints should be hard to bypass without an explicit override.

## Source notes

NKBA's fourth-edition overview says its guidelines cover activity centers, seating, cabinetry/casework, finishes/materials, storage, lighting, systems coordination, code compliance, universal design, and sustainability; it is a professional planning reference, not a building code. [NKBA overview](https://kb.nkba.org/kitchen-bath-planning-guidelines/)

Always check the jurisdiction, appliance installation manual, countertop fabricator requirements, electrical/plumbing/ventilation code, and the actual cabinet manufacturer's construction instructions before treating any number above as buildable project documentation.
