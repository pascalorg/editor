'use client'

import { useIsMobile } from '../../hooks/use-mobile'
import { openExtension } from '../../lib/inspector-card-mode'
import { useInspectorExpanded } from '../../lib/inspector-expanded'
import { renderExtensionIcon, useInspectorExtensions } from '../ui/panels/inspector-extensions'
import { ActionMenuButton } from './action-menu-button'

/**
 * One action-menu button per plugin inspector extension of the selected node
 * (`Plugin.inspectorExtensions`, e.g. a wall's Engineering): it opens the
 * inspector card on that extension, or keeps it there. The extension that owns
 * the card body for this node (`primaryWhen`) is already showing and gets none;
 * the mobile sheet lists every extension under the kind's controls instead.
 */
export function InspectorExtensionActions() {
  const isMobile = useIsMobile()
  const { extensions, primaryExtension } = useInspectorExtensions()
  const active = useInspectorExpanded((state) => (state.expanded ? state.activeExtensionId : null))
  if (isMobile) return null
  return extensions
    .filter((extension) => extension !== primaryExtension)
    .map((extension) => (
      <ActionMenuButton
        key={extension.id}
        label={extension.title}
        onClick={(event) => {
          event.stopPropagation()
          useInspectorExpanded.getState().applyMode(openExtension(extension.id))
        }}
        pressed={active === extension.id}
      >
        {renderExtensionIcon(extension.icon)}
      </ActionMenuButton>
    ))
}
