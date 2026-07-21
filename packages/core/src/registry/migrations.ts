export function applyNodeMigrations(
  node: unknown,
  migrations: Record<number, (old: unknown) => unknown> | undefined,
): unknown {
  if (!migrations) return node
  return Object.entries(migrations)
    .sort(([left], [right]) => Number(left) - Number(right))
    .reduce((value, [, migrate]) => migrate(value), node)
}
