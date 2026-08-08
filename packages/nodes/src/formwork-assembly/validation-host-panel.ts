import type { EditorHostPanel } from '@pascal-app/editor'

/**
 * The rail entry for the buildability check.
 *
 * Beside the takeoff and for the same reason it is a host panel: the subject is a
 * scope — the project, or a level — and neither is a node anybody can select. The
 * pairing is the point. One says what the level orders; this one says whether what it
 * orders can be erected, which until now the engine could answer and the product
 * could not show.
 *
 * Lazy, because validating the scope solves every shutter in it.
 */
export const formworkValidationHostPanel: EditorHostPanel = {
  id: 'formwork-validation',
  label: 'Buildability',
  icon: { kind: 'iconify', name: 'lucide:shield-alert' },
  component: () => import('./validation-panel'),
  description:
    'Whether the formwork in scope can be built: unformable runs, ties that reach no wall, corners no unit sweeps, pours over the supply limit — with what could not be checked stated alongside.',
}
