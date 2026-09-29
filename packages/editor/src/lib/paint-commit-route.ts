/**
 * How a paint click commits its resolved spread. Only a spread that is exactly
 * the hovered surface keeps the kind's own commit; anything else — several
 * targets, or one target on another role such as a whole room's
 * `room:<zoneId>` role — goes through the fan-out, which routes each role to
 * the kind that owns it. A one-wall room therefore needs no second target to
 * reach its room role.
 */
export function paintCommitRoute(
  targets: ReadonlyArray<{ nodeId: string; role: string }>,
  nodeId: string,
  role: string,
): 'own' | 'fanout' {
  if (targets.length === 0) return 'own'
  const [only] = targets
  return targets.length === 1 && only!.nodeId === nodeId && only!.role === role ? 'own' : 'fanout'
}
