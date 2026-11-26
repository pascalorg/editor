export const TREE_FORMS = [
  'round',
  'spreading',
  'upright',
  'conifer',
  'weeping',
  'multistem',
] as const

export const TREE_LIMITS = {
  minHeight: 0.2,
  maxHeight: 1000,
  minSpread: 0.1,
  maxSpread: 1000,
  maxCoordinate: 10_000,
  maxTrees: 40,
} as const
