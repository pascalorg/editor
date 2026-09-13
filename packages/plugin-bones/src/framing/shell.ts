/**
 * The level's SHELL — everything the host draws for a level that is not
 * framing: walls (with their doors, windows and wall-mounted items), roofs
 * and roof segments, slabs, ceilings, stairs, zones, furniture, guides.
 *
 * The 'framing' view mode ("show all framing only", Steve 2026-09-05) hides
 * exactly this set. It is derived from the scene tree, never from a list of
 * node kinds: a plugin's node under the level is shell too, and a bones node
 * (framing, service points, devices — anything whose kind is `bones:*`) is
 * never hidden by the mode that exists to show it.
 */
type TreeNode = { type?: unknown; children?: unknown }

/**
 * Member roles that are SURFACES laid over the frame, not the frame: wall
 * assembly layers (gypsum, sheathing, WRB, cladding, cavity insulation), the
 * roof deck and subfloor (both 'sheathing' / 'subfloor'), the under-slab
 * vapor retarder and the drip edge. The 'framing' view mode skips them so
 * studs, plates, headers, rafters and joists read unobstructed; everything
 * else — lumber, foundation concrete, hardware, and the MEP runs the panel's
 * own toggles allow — draws solid.
 */
export const SURFACE_ROLES: ReadonlySet<string> = new Set([
  'drywall',
  'sheathing',
  'wrb',
  'cladding',
  'insulation',
  'subfloor',
  'vapor-retarder',
  'drip-edge',
])

/** True for a member the framing-only view draws. */
export function isFrameMember(member: { role: string }): boolean {
  return !SURFACE_ROLES.has(member.role)
}

/** Ids of every non-bones node under `levelId`, depth-first, level excluded. */
export function shellNodeIds(
  nodes: Record<string, TreeNode | undefined>,
  levelId: string,
): string[] {
  const out: string[] = []
  const level = nodes[levelId]
  if (!level) return out
  const stack: string[] = childIds(level).reverse()
  const seen = new Set<string>()
  while (stack.length > 0) {
    const id = stack.pop() as string
    if (seen.has(id)) continue
    seen.add(id)
    const n = nodes[id]
    if (!n) continue
    if (typeof n.type === 'string' && n.type.startsWith('bones:')) continue
    out.push(id)
    const kids = childIds(n)
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i] as string)
  }
  return out
}

function childIds(n: TreeNode): string[] {
  return Array.isArray(n.children)
    ? n.children.filter((c): c is string => typeof c === 'string')
    : []
}
