/**
 * Mode machine for the floating inspector card (`PanelWrapper`).
 *
 * The card is in exactly one of three modes — the two expanded modes are
 * EITHER/OR, never combined:
 *
 * - collapsed: header only;
 * - regular: the node kind's own controls (`children`) — no plugin
 *   inspector-extension sections appended;
 * - extension: ONE plugin inspector-extension's content fills the body
 *   (its own section chrome), the regular controls are hidden.
 *
 * Transitions:
 * - chevron / header press ({@link toggleCard}): collapsed → regular,
 *   regular → collapsed, extension → regular (exit extension mode first,
 *   stay expanded);
 * - an extension's action-menu button ({@link openExtension}): enters that
 *   extension's mode from anywhere (expanding a folded card); pressed while
 *   that extension is already showing, it keeps it showing.
 */

export interface InspectorCardMode {
  /** Card folded to its header. */
  collapsed: boolean
  /** Extension whose content fills the body; null = regular controls. */
  activeExtensionId: string | null
}

/** Chevron / header press. */
export function toggleCard(mode: InspectorCardMode): InspectorCardMode {
  // Folded → expand to the regular controls.
  if (mode.collapsed) return { collapsed: false, activeExtensionId: null }
  // Extension mode → back to the regular controls (stay expanded).
  if (mode.activeExtensionId !== null) return { collapsed: false, activeExtensionId: null }
  // Regular expanded → fold.
  return { collapsed: true, activeExtensionId: null }
}

/** An extension's action-menu button: opens the card on that extension, or keeps it there. */
export function openExtension(extensionId: string): InspectorCardMode {
  return { collapsed: false, activeExtensionId: extensionId }
}

/**
 * The extension whose content should fill the card body, or null for the
 * regular controls. A stale `activeExtensionId` (selection changed kind,
 * plugin uninstalled, registry reset) safely falls back to regular mode.
 */
export function resolveActiveExtension<E extends { id: string }>(
  activeExtensionId: string | null,
  extensions: readonly E[],
): E | null {
  if (activeExtensionId === null) return null
  return extensions.find((extension) => extension.id === activeExtensionId) ?? null
}
