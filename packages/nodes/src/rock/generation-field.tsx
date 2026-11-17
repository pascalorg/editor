import { planRock, type RockNode } from '@pascal-app/core'

export function rockUpgradeProblem(rock: RockNode): string | null {
  const plan = planRock({ ...rock, gen: 2 })
  return plan.problem ?? (plan.withinBudget ? null : 'The outline exceeds the geometry budget.')
}

export function RockGenerationField({ node }: { node: RockNode }) {
  const legacy = (node.gen ?? 1) === 1
  const problem = legacy ? rockUpgradeProblem(node) : null
  return (
    <p className="text-xs text-muted-foreground">
      {legacy
        ? 'Generator 1 · Legacy look. Upgrade to generator 2 to choose a rock type, weathering and moss. Upgrading changes the shape and stone finish, including any slab holes.'
        : 'Generator 2 · Rock type, weathering and moss are available.'}
      {problem && ` Upgrade unavailable: ${problem}`}
      {' Randomise changes only the seed, keeping the type and looks.'}
    </p>
  )
}
