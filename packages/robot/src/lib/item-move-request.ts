type NavigationItemMoveRequestLike = {
  itemId: string
  operation?: 'copy' | 'move'
  targetPreviewItemId?: string | null
  visualItemId?: string | null
}

function isCopyPreviewId(id: string | null | undefined) {
  return Boolean(id?.startsWith('item_debug_copy_preview_'))
}

function isCopyCarryVisualId(id: string | null | undefined) {
  return Boolean(id?.endsWith('__copy_carry'))
}

export function isNavigationItemMoveCopyOperation(
  request: NavigationItemMoveRequestLike | null | undefined,
) {
  if (!request) {
    return false
  }

  if (request.operation) {
    return request.operation === 'copy'
  }

  return isCopyPreviewId(request.targetPreviewItemId) || isCopyCarryVisualId(request.visualItemId)
}

export function normalizeNavigationItemMoveOperation<T extends NavigationItemMoveRequestLike>(
  request: T,
): T & { operation: 'copy' | 'move' } {
  return {
    ...request,
    operation: isNavigationItemMoveCopyOperation(request) ? 'copy' : 'move',
  }
}
