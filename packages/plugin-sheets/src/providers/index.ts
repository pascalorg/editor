/**
 * Built-in sheet drawing providers. One call from bootstrap registers them
 * all; each module owns its own key and file (see the workstream table in
 * docs/plan-set-gap-analysis.md).
 */
import { registerSheetDrawingProvider } from '../drawings'
import { registerElectricalProvider } from './electrical'
import { registerEnergyProvider } from './energy'
import { registerGeneralNotesProvider } from './general-notes'
import { registerPlumbingProvider } from './plumbing'
import { registerStructuralProvider } from './structural'

export function registerBuiltinSheetProviders(): void {
  registerStructuralProvider(registerSheetDrawingProvider)
  registerElectricalProvider(registerSheetDrawingProvider)
  registerPlumbingProvider(registerSheetDrawingProvider)
  registerEnergyProvider(registerSheetDrawingProvider)
  registerGeneralNotesProvider(registerSheetDrawingProvider)
}
