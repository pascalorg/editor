import { registerSemanticRecipe, semanticRecipeRegistry } from '@pascal-app/core'
import {
  centrifugalPumpRecipe,
  distillationUnitRecipe,
  refineryAuxiliaryUnitRecipe,
  refineryReactorUnitRecipe,
  storageTankRecipe,
} from '@pascal-app/plugin-factory-equipment'

const FACTORY_RECIPES = [
  centrifugalPumpRecipe,
  storageTankRecipe,
  distillationUnitRecipe,
  refineryAuxiliaryUnitRecipe,
  refineryReactorUnitRecipe,
] as const

export function ensureFactorySemanticRecipesRegistered(): void {
  for (const recipe of FACTORY_RECIPES) {
    if (!semanticRecipeRegistry.has(recipe.id)) {
      registerSemanticRecipe(recipe)
    }
  }
}
