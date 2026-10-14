import type { Plugin } from '@pascal-app/core'
import type { EditorHostPanel } from '@pascal-app/editor'

/** IFC is a file workflow, so it contributes an editor panel rather than node kinds. */
export const ifcPlugin: Plugin = {
  id: 'pascal:ifc',
  apiVersion: 1,
}

export const ifcHostPanel: EditorHostPanel = {
  id: 'pascal:ifc:import-export',
  pluginId: 'pascal:ifc',
  label: 'IFC Import / Export',
  description: 'Import IFC building models and export Pascal scenes as IFC4.',
  summary: 'Import IFC files and export edited scenes as IFC4.',
  category: 'Import & export',
  icon: { kind: 'iconify', name: 'lucide:building-2' },
  component: () => import('./panel'),
  defaultInstalled: true,
}

export { createIfcImportOperations, type SceneImportOperation } from './import-scene'
