import type { DuctFittingNode, NodeQuickAction, PipeFittingNode, SceneApi } from '@pascal-app/core'

export function ductFittingQuickActions({ node }: { node: DuctFittingNode }): NodeQuickAction[] {
  const variants = (['sheet-metal', 'spiral', 'flex', 'duct-board'] as const).map(
    (ductMaterial) => ({
      id: `duct-fitting:material:${ductMaterial}`,
      label: ductMaterial === 'duct-board' ? 'Duct board' : ductMaterial.replace('-', ' '),
      title: `Use ${ductMaterial.replace('-', ' ')} for this fitting`,
      disabled: node.ductMaterial === ductMaterial,
      history: 'single' as const,
      run: ({ sceneApi }: { sceneApi: SceneApi }) => {
        sceneApi.update(node.id, { ductMaterial })
        return { selectedIds: [node.id] }
      },
    }),
  )
  return variants
}

export function pipeFittingQuickActions({ node }: { node: PipeFittingNode }): NodeQuickAction[] {
  const variants = (['pvc', 'abs', 'cast-iron'] as const).map((pipeMaterial) => ({
    id: `pipe-fitting:material:${pipeMaterial}`,
    label: pipeMaterial === 'cast-iron' ? 'Cast iron' : pipeMaterial.toUpperCase(),
    title: `Use ${pipeMaterial.replace('-', ' ')} for this fitting`,
    disabled: node.pipeMaterial === pipeMaterial,
    history: 'single' as const,
    run: ({ sceneApi }: { sceneApi: SceneApi }) => {
      sceneApi.update(node.id, { pipeMaterial })
      return { selectedIds: [node.id] }
    },
  }))
  return variants
}
