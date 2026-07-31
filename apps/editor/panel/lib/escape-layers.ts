'use client';

import { useEffect } from 'react';

/**
 * The Escape chain, as a stack.
 *
 * The design specifies one order — menu → command palette → drawer → dialog →
 * inline edit — and one rule: a single press closes the topmost layer only.
 *
 * That rule was previously left to each screen, with a `window` keydown listener
 * per layer. It cannot work: every listener sees every press, so opening a
 * dialog from inside the drawer and pressing Escape closed both at once, and
 * five of the eight dialogs registered no listener at all and could not be
 * closed from the keyboard.
 *
 * A stack fixes the ordering by construction. Layers push on open and pop on
 * close; only the last entry is called. Mounting order is the nesting order, so
 * the chain is whatever the component tree already says it is — no layer needs
 * to know what is above or below it.
 */
const layers: Array<() => void> = [];
let listening = false;

function onKeyDown(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || layers.length === 0) return;

  const top = layers[layers.length - 1];
  event.preventDefault();
  // Stops a native listener further out from treating the same press as its own.
  event.stopPropagation();
  top?.();
}

/**
 * Registers a layer imperatively and returns its removal function. Exported for
 * the tests, which exercise the ordering rule without mounting React.
 */
export function pushEscapeLayer(close: () => void): () => void {
  layers.push(close);

  if (!listening) {
    // Capture phase, so the chain sees the press before anything inside the
    // dialog can swallow it.
    window.addEventListener('keydown', onKeyDown, true);
    listening = true;
  }

  return () => {
    const index = layers.lastIndexOf(close);
    if (index !== -1) layers.splice(index, 1);

    if (layers.length === 0 && listening) {
      window.removeEventListener('keydown', onKeyDown, true);
      listening = false;
    }
  };
}

/**
 * Registers a dismissible layer while `active` is true.
 *
 * `onClose` is read through a ref-like closure on every render so a stale
 * handler is never called — the stack stores the identity, the effect keeps it
 * current by re-registering when it changes.
 */
export function useEscapeLayer(active: boolean, onClose: () => void): void {
  useEffect(() => {
    if (!active) return;
    return pushEscapeLayer(onClose);
  }, [active, onClose]);
}

/** Test seam: how many layers are currently open. */
export function openLayerCount(): number {
  return layers.length;
}
