/**
 * Whether a node is flatwork the site's works laid on a level (`add_site_surface`: a lawn, a
 * driveway, a path, a patio, marked `metadata.flatwork`). It stands on the building's level for its
 * elevation, but it is outdoors and not a floor of the building: it takes no part in where the
 * building stands against the ground (a lot-wide lawn under a hill is not a floor buried by it), in
 * what covers a basement (a lawn does not), or in the box the level's rooms stand in.
 */
export function isSiteFlatwork(node: { metadata?: unknown }): boolean {
  const metadata = node.metadata
  return typeof metadata === 'object' && metadata !== null && 'flatwork' in metadata
}
