import { planRock, type RockNode, usePascalI18n } from '@pascal-app/core'

export function rockUpgradeProblem(rock: RockNode): string | null {
  const plan = planRock({ ...rock, gen: 2 })
  return plan.problem ?? (plan.withinBudget ? null : 'The outline exceeds the geometry budget.')
}

export function RockGenerationField({ node }: { node: RockNode }) {
  const i18n = usePascalI18n()
  const legacy = (node.gen ?? 1) === 1
  const problem = legacy ? rockUpgradeProblem(node) : null
  return (
    <p className="text-xs text-muted-foreground">
      {legacy
        ? i18n._({
            id: 'node.rock.generation.legacy',
            message:
              'Generator 1 · Legacy look. Upgrade to generator 2 to choose a rock type, weathering and moss. Upgrading changes the shape and stone finish, including any slab holes.',
          })
        : i18n._({
            id: 'node.rock.generation.current',
            message: 'Generator 2 · Rock type, weathering and moss are available.',
          })}
      {problem &&
        ` ${i18n._({
          id: 'node.rock.generation.upgradeUnavailable',
          message: 'Upgrade unavailable: {problem}',
          values: { problem },
        })}`}
      {` ${i18n._({
        id: 'node.rock.generation.randomise',
        message: 'Randomise changes only the seed, keeping the type and looks.',
      })}`}
    </p>
  )
}
