export const PRIMITIVE_GENERATION_SKILL_PROMPT = `
===== PRIMITIVE GENERATION SKILL =====
Use this as the compact operating manual for primitive geometry generation.

1. Mental model: parts are the building-block library, recipes are instruction sheets, and assembly is the automatic instruction-sheet generator.
- Parts are reusable geometry kernels with parameters such as length, width, height, radius, count, color, material, position, and semanticRole. Keep parts generic: wheel/wheel_set, window_panel/window_strip, body_shell, tube_frame, fork, light_pair, bar_pair, streamlined_body, lofted_panel, airfoil_blade, pipe/flange/bolt parts, etc.
- Recipes stay small, deterministic, and professional. They are for precise standard parts with stable engineering parameters, not whole-object families.
- Assembly is for supported families where the program can infer the part plan from object constraints. If compose_assembly does not support the requested family/object, do not stop; switch to compose_parts and build it from generic parts.

2. Route by capability, not by object name:
- Constraint-first generic assembly: vehicles, outdoor AC units, machine tools (lathe/milling/grinder/planer/drill/CNC), pumps, conveyors, fans, tanks, distillation/chemical towers or columns, reactors, compressors, grate coolers, electrical cabinets, and broad industrial equipment. Plain chimneys/smokestacks are not assembly towers; use compose_parts with chimney_stack, not vertical_pole/circular_base or raw cylinders.
- Closed-form standard recipes only: gear.spur, sprocket.chain, pipe.flange, pipe.elbow90, fastener.hexBolt, bearing.pillowBlock, coupling.flexible, plate.perforated, valve.gate/ball, robotArm.threeAxis, mixer.impeller, motor.servo.
- Reusable part kernel: fans, pumps/blowers, chimney_stack smokestacks, pipe ports/flanges, vent_grill/vent_slats, rounded_machine_body, tanks, desks, cabinets, bicycles, generic wheels/windows/lights/body shells, shaft + hub + blades, ellipsoid_shell domes/covers, curved_panel/curved_lens_panel, ergonomic shells, airfoil blades, streamlined bodies, lofted_shell/lofted_panel transitions, aircraft_fuselage complete aircraft defaults, pyramid shapes (use pyramid part for square/rectangular pyramids, pointed rooftops, gem shapes, and cone-like forms with a square base; set truncated:true or topScale to flatten the apex).
- For industrial chimneys/smokestacks, use exactly one compose_parts part: {kind:"chimney_stack", semanticRole:"chimney_body", height, radius, warningStripes:true}. Use warningStripes:true for red-white top bands; do not approximate chimneys with a plain vertical_pole, cylinder, circular_base cap, or tower assembly.
- For complete aircraft/airplanes/airliners, use compose_parts with one part {kind:"aircraft_fuselage", id:"aircraft_fuselage"} plus top-level length/primaryColor. Let aircraft defaults add wings, engines, T-tail, windows, and landing gear. Do not hand-place generic airfoil_blade, streamlined_body, or wheel_set parts for a complete aircraft.
- Raw compose_primitive only when the requested surface cannot be expressed by recipe, assembly, or reusable parts.

3. Prevent recipe explosion:
- Do not create/use a recipe for every object family. Unsupported complete objects such as aircraft should use compose_parts with the aircraft_fuselage part and top-level constraints, because that kernel owns the coherent fuselage, wings, engines, tail, windows, and landing gear layout.
- Shaft + hub + propeller/impeller/agitator/mud-mixer blades must be compose_parts: vertical_pole or cylinder shaft + circular_base hub + propeller_blade_set.
- The propeller_blade_set kernel owns circular 120-degree placement, blade orientation, pitch, vertical curve, and taiji_half/airfoil profiles.

4. Prefer relationships over coordinates:
- connectTo + connectPoint + childPoint for ports, flanges, pipes, and semantic attachment points.
- alignAbove, centeredOn, alignBeside, side for readable layout.
- around + aroundCount + aroundRadius for circular repetition. Do not ask the model to manually calculate radial coordinates.
- Use protective_grill for fan guards/cages, and vent_grill for louvered equipment vents instead of plain dark rectangles.
- Use ellipsoid_shell for domed covers, helmet-like shells, tank heads, mouse-like smooth caps, and rounded equipment housings.
- Use curved_panel/curved_lens_panel for bent transparent panels, goggles/sunglasses lenses, visors, and curved face plates.
- Use lofted_shell/lofted_panel when a surface must transition between multiple cross-sections instead of stacking boxes.

5. Preserve user constraints:
- Explicit dimensions, counts, colors, materials, and "same level / same plane / horizontal" constraints must be copied into the tool call.
- For open-ended complete objects, prefer compose_assembly only when the family is supported; otherwise use compose_parts with generic building blocks. Pass hard constraints such as length, width/diameter, height, primaryColor. Do not let default recipe colors/sizes override user wording.
- If the user says blades are same horizontal level, set bladePitch to 0 or use a part field that keeps all blade centers at the same elevation; do not introduce alternating height offsets.
- If the user only complains about one detail in a follow-up, prefer revise_geometry and preserve approved parts. For color-only edits, use setMaterial with semanticRole selectors instead of replace/materialFrom.

6. Make the visible answer useful:
- If generation fails, report the failure category and a concrete next action for this object family.
- Never show unrelated examples such as valve advice unless the failed request is actually a valve.
`

export function buildPrimitiveGenerationSkillPrompt() {
  return PRIMITIVE_GENERATION_SKILL_PROMPT.trim()
}
