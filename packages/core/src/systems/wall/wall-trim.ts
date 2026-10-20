import {
  WALL_TRIM_DEFAULTS,
  type WallNode,
  WallTrimConfig,
  type WallTrimKind,
} from '../../schema/nodes/wall'

/**
 * A wall's skirting, crown or chair rail with `patch` applied over what it shows now (its stored
 * config over the kind's defaults): the one write the wall panel and the agent operations share.
 */
export function wallTrimPatch<K extends WallTrimKind>(
  wall: Partial<Pick<WallNode, K>>,
  kind: K,
  patch: Partial<WallTrimConfig>,
): Record<K, WallTrimConfig> {
  return {
    [kind]: WallTrimConfig.parse({ ...WALL_TRIM_DEFAULTS[kind], ...wall[kind], ...patch }),
  } as Record<K, WallTrimConfig>
}
