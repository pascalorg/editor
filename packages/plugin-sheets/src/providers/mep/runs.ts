/**
 * Bones members → plan lines.
 *
 * The engines model a wire, a pipe or a duct as a BOX: `dims` in the member's
 * local frame, centred at `position`, turned by `rotation`. On paper a run is
 * a line, so the box is projected back to the two plan points it spans.
 *
 * The convention is the one the routers emit with (`routeWiring`,
 * `routePipe`): a horizontal leg is `dims = [length, section, section]` with
 * `rotation[1] = atan2(-dz, dx)`, and `Ry(theta)` maps the member's local +X
 * onto `(cos theta, -sin theta)` in the (x, z) plan frame. A VERTICAL leg —
 * a riser, a stack — is `[section, length, section]` and projects to a single
 * point, so it returns null and is drawn as a symbol instead of a zero-length
 * line.
 */

export type RunMember = {
  position: readonly [number, number, number]
  dims: readonly [number, number, number]
  rotation: readonly [number, number, number]
}

export function runEnds(member: RunMember): [[number, number], [number, number]] | null {
  const [dx, dy, dz] = member.dims
  if (!(dx > dy && dx > dz)) return null
  const theta = member.rotation[1]
  const ux = Math.cos(theta) * (dx / 2)
  const uz = -Math.sin(theta) * (dx / 2)
  const [px, , pz] = member.position
  return [
    [px - ux, pz - uz],
    [px + ux, pz + uz],
  ]
}
