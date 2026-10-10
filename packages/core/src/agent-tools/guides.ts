/**
 * A step of the plans guide (BUILD_FROM_PLANS_GUIDE), registered by the module whose tools it
 * teaches, so each slice brings its own steps; the general order stays here, with the check that
 * closes every phase.
 */
export type PlansGuideSection = { name: string; order: number; text: string }

const PLANS_GUIDE_ORDER =
  'Work from general to particular, so the whole building stands before its details. A house of one or two storeys goes plan, walls, openings, roof, site, furniture: read and scale each floor plan (1, 2), its floor and exterior walls (3), its partitions (create_reference_elements), the doors and windows in the gaps the walls leave (openGaps), the roof (4) and facade (5), the site, then the furniture the plan draws (furnish_from_plan). For an apartment building (building maps, apartments, cores, floors that repeat), finish each phase on every distinct floor before the next, and build the floors a survey family repeats once, copied last (8). Batch what you can write in advance — a phase on every floor, many deletions, rebuilds with replace, the check that closes it — with run_batch: one call, one undo step, a report per call. A reference image is the specification: look for its details, build each one or the nearest the tools allow, say which you could not build, and give the faces it does not show its style; record_reference keeps that list, and verify_scene shows what is still unbuilt.'

const sections: PlansGuideSection[] = [
  {
    name: 'check',
    order: 9,
    text: "9. Check with verify_scene after each phase. Prefer native operations for walls, windows and facades: custom blocks or raw patches standing in for them mean a tool was missed. Furniture and decorative features (a table, a bench, a cornice, a sunshade, a canopy) can use add_object for requested shapes, dimensions or style, even when generic catalog equivalents exist. Name each feature and record its design intent in reason; never use add_object for walls, slabs, openings, stairs, roofs or balconies. The final report quotes verify_scene's inventory statuses (built, approximated, not possible) for what the reference shows, rather than its own account.",
  },
]

/** Adds a step to the plans guide; registering a name again replaces it. */
export function registerPlansGuideSection(section: PlansGuideSection) {
  const at = sections.findIndex((known) => known.name === section.name)
  if (at >= 0) sections[at] = section
  else sections.push(section)
  sections.sort((a, b) => a.order - b.order)
}

/** The plans guide: the general order, then the registered steps by number. */
export function plansGuide(): string {
  return [PLANS_GUIDE_ORDER, ...sections.map((section) => section.text)].join('\n')
}

/**
 * What to do with what the user gives, where an agent looks first: the MCP server's instructions,
 * create_project's result, the chat's plans playbook. Run 3 (2026-10-05) measured its plan image in
 * the shell before its first call and never reached import_plan_reference or record_reference.
 * And what a twin from them includes (the user, 19:51): the site as well as the building.
 */
export const REFERENCE_INPUTS_GUIDE = [
  'A floor plan the user gives (PNG, JPEG, WebP or SVG): import_plan_reference places it on the floor and traces its walls. In the chat, pass the URL of the attached file. Over the MCP, upload a file on your machine with request_upload where the server offers it and pass its asset:<id>, else read it into a data:image/...;base64 URL; inline only small SVGs. Then calibrate_plan_reference on a printed dimension, and create_reference_elements builds the walls, its openGaps listing the door and window gaps: no need to measure the plan by hand.',
  "A photo or render of the building is the specification: record_reference lists what it shows, verify_scene lists what is still unbuilt, and view_scene renders the model to compare with it. A storey's height comes from the plan or the photo (a door is about 2.1 m, a scale the photo always has), the default only when neither shows it. Where its glass meets at a corner, with no wall between the panes, that is one corner window: add_corner_window builds both sides, the glass fused or at a post.",
  "A twin from a plan and a photo is the building and the site they show. Where the photo shows the site, build what it shows and add nothing it doesn't (the lot, driveway, paths, lawn, planting, fences, outdoor lights and a letterbox are examples, not a list); areas it doesn't show, such as the sides and back, get plausible defaults in the same style. Ask at the start only where the request departs from this.",
].join('\n')
