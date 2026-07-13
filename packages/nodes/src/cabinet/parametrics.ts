import type { CabinetModuleNode, CabinetNode, ParametricDescriptor } from '@pascal-app/core'
import { cabinetCornerUnlinkPatchesOnDelete, cabinetEmptyRunCascadeDeleteIds } from './run-ops'

export const cabinetParametrics: ParametricDescriptor<CabinetNode> = {
  groups: [
    {
      label: 'Dimensions',
      fields: [
        { key: 'width', kind: 'number', unit: 'm', min: 0.3, max: 3, step: 0.05 },
        { key: 'depth', kind: 'number', unit: 'm', min: 0.3, max: 1.2, step: 0.01 },
        { key: 'carcassHeight', kind: 'number', unit: 'm', min: 0.4, max: 2.4, step: 0.01 },
      ],
    },
    {
      label: 'Position',
      fields: [{ key: 'position', kind: 'vec3' }],
    },
  ],
  // Deleting one L-corner member removes only it; these patches keep the
  // corner-link metadata on the survivors consistent.
  onDelete: (node, nodes) => cabinetCornerUnlinkPatchesOnDelete(node, nodes),
  // A derived leg run lives under its source run — deleting the last child
  // of a run deletes the now-empty run group too.
  onDeleteCascade: (node, nodes, pendingDeleteIds) =>
    cabinetEmptyRunCascadeDeleteIds(node, nodes, pendingDeleteIds),
  customPanel: () => import('./panel'),
}

export const cabinetModuleParametrics: ParametricDescriptor<CabinetModuleNode> = {
  groups: [
    {
      label: 'Dimensions',
      fields: [
        { key: 'width', kind: 'number', unit: 'm', min: 0.3, max: 3, step: 0.05 },
        { key: 'depth', kind: 'number', unit: 'm', min: 0.3, max: 1.2, step: 0.01 },
        { key: 'carcassHeight', kind: 'number', unit: 'm', min: 0.4, max: 2.4, step: 0.01 },
      ],
    },
    {
      label: 'Position',
      fields: [{ key: 'position', kind: 'vec3' }],
    },
  ],
  // Deleting one L-corner member removes only it; these patches keep the
  // corner-link metadata on the survivors consistent.
  onDelete: (node, nodes) => cabinetCornerUnlinkPatchesOnDelete(node, nodes),
  // Deleting the run's last module deletes the now-empty run group too.
  onDeleteCascade: (node, nodes, pendingDeleteIds) =>
    cabinetEmptyRunCascadeDeleteIds(node, nodes, pendingDeleteIds),
  customPanel: () => import('./panel'),
}
