// Keys typed into a field (the room-name combobox, any input, an open dialog)
// belong to that field, never to a canvas gesture.
const TYPING_TARGET =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="combobox"], [role="textbox"], [role="dialog"], [role="alertdialog"]'

export function isTypingTarget(target: EventTarget | null) {
  const element = target as { closest?: (selector: string) => unknown; isContentEditable?: boolean }
  return !!element && (element.isContentEditable === true || !!element.closest?.(TYPING_TARGET))
}
