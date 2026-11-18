export const TREE_FORMS = [
  'round',
  'spreading',
  'upright',
  'conifer',
  'weeping',
  'multistem',
] as const

export const TREE_LIMITS = {
  minHeight: 2,
  maxHeight: 25,
  minSpread: 0.5,
  maxSpread: 30,
  maxCoordinate: 10_000,
  maxTrees: 40,
} as const
