export type BlockSfxAction =
  | 'tool-select'
  | 'component-select'
  | 'drag-start'
  | 'move-step'
  | 'rotate-step'
  | 'resize-step'
  | 'operation-start'
  | 'operation-commit'
  | 'delete'
  | 'cancel'
  | 'finish'

const BLOCK_SFX = {
  'tool-select': 'sfx:menu-click',
  'component-select': 'sfx:item-pick',
  'drag-start': 'sfx:item-pick',
  'move-step': 'sfx:grid-snap',
  'rotate-step': 'sfx:item-rotate',
  'resize-step': 'sfx:resize',
  'operation-start': 'sfx:structure-build-start',
  'operation-commit': 'sfx:structure-build',
  delete: 'sfx:structure-delete',
  cancel: 'sfx:menu-click',
  finish: 'sfx:item-place',
} as const satisfies Record<BlockSfxAction, string>

export function blockSfx(action: BlockSfxAction) {
  return BLOCK_SFX[action]
}
