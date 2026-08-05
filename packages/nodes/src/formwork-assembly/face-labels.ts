import type { FaceRole } from '@pascal-app/core/formwork'

/**
 * How a face role is named to a person. Shared by the inspector's coverage list
 * and the formwork schedule, because a face called "Front face" in the panel and
 * something else on the drawing is two names for one surface, and the crew has to
 * reconcile them.
 */
export const FACE_ROLE_LABELS: Record<FaceRole, string> = {
  'side-a': 'Front face',
  'side-b': 'Back face',
  'end-start': 'Start end',
  'end-end': 'Far end',
  top: 'Top',
  bottom: 'Bottom',
  'column-face-1': 'Face 1',
  'column-face-2': 'Face 2',
  'column-face-3': 'Face 3',
  'column-face-4': 'Face 4',
  shaft: 'Shaft',
  soffit: 'Soffit',
  edge: 'Edge',
}

/** Vertical faces first, then the horizontal ones — the order they are erected in. */
export const FACE_ORDER: readonly FaceRole[] = [
  'side-a',
  'side-b',
  'end-start',
  'end-end',
  'column-face-1',
  'column-face-2',
  'column-face-3',
  'column-face-4',
  'shaft',
  'edge',
  'soffit',
  'top',
  'bottom',
]
