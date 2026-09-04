'use client';

import { useEffect, type RefObject } from 'react';

/**
 * What makes a modal usable from the keyboard.
 *
 * `aria-modal="true"` tells assistive technology the rest of the page is
 * unavailable; it does not stop Tab from walking straight out of the dialog into
 * the page behind it. Without the trap below, tabbing through a confirmation
 * dialog put focus on the table underneath while the overlay still covered it —
 * the focus ring was invisible and Enter activated something the user could not
 * see.
 *
 * Three obligations, all of them WCAG 2.4.3:
 *
 * 1. move focus into the dialog when it opens,
 * 2. keep Tab and Shift+Tab inside it,
 * 3. put focus back where it came from when it closes.
 */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusableWithin(node: HTMLElement): HTMLElement[] {
  return [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    // offsetParent is null for anything display:none — a collapsed section's
    // controls must not become a stop in the tab order.
    (el) => el.offsetParent !== null || el === document.activeElement,
  );
}

/**
 * `ready` exists because a panel can mount before it has anything to focus. The
 * user drawer renders null until its fetch resolves, so an effect keyed only on
 * the ref runs once against an empty ref and never again — the trap silently
 * never engages. Pass the same condition that gates the render.
 */
export function useModalFocus(ref: RefObject<HTMLElement | null>, ready = true): void {
  useEffect(() => {
    const node = ref.current;
    if (!ready || !node) return;

    const returnTo = document.activeElement as HTMLElement | null;
    const restoreInert = makeRestInert(node);

    // After the background goes inert, not before: marking an ancestor of the
    // focused element inert blurs it, and we want to land somewhere deliberate.
    const first = focusableWithin(node)[0];
    (first ?? node).focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;

      const items = focusableWithin(node);
      if (items.length === 0) {
        // A dialog with nothing focusable still must not leak focus outward.
        event.preventDefault();
        return;
      }

      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;

      if (event.shiftKey && (active === first || active === node)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    node.addEventListener('keydown', onKeyDown);

    return () => {
      node.removeEventListener('keydown', onKeyDown);
      restoreInert();
      // The trigger may have unmounted with the dialog — a delete confirmation
      // closes over a row that no longer exists — so this is best-effort.
      if (returnTo?.isConnected) returnTo.focus();
    };
  }, [ref, ready]);
}

/**
 * Marks everything outside `node` inert, and returns the undo.
 *
 * The focus trap keeps Tab inside a dialog; it does nothing about a screen
 * reader's virtual cursor, which walks the DOM and will happily read the table
 * behind an overlay. `aria-modal` is supposed to cover that and is unevenly
 * honoured; `inert` removes the subtree from focus, hit-testing and the
 * accessibility tree at once.
 *
 * The dialog renders inside the app tree, so there is no single ancestor to
 * mark. Walk up from the dialog and inert each ancestor's *other* children:
 * that is the whole document minus the dialog's own branch. Only elements this
 * call changed are restored, so nesting a dialog inside a drawer unwinds in the
 * right order and anything already inert stays that way.
 */
function makeRestInert(node: HTMLElement): () => void {
  const changed: HTMLElement[] = [];

  let current: HTMLElement | null = node;
  while (current && current !== document.body) {
    const parent: HTMLElement | null = current.parentElement;
    if (!parent) break;

    const siblings: Element[] = Array.from(parent.children);
    for (const sibling of siblings) {
      if (sibling === current || !(sibling instanceof HTMLElement) || sibling.inert) continue;
      sibling.inert = true;
      changed.push(sibling);
    }
    current = parent;
  }

  return () => {
    for (const el of changed) el.inert = false;
  };
}
