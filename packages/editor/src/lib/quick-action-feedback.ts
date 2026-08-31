const activeAnimations = new WeakMap<HTMLElement, Animation>()

export function playBlockedQuickActionFeedback(button: HTMLButtonElement, reducedMotion: boolean) {
  const content = button.querySelector<HTMLElement>('[data-quick-action-feedback]')
  if (!content) return

  activeAnimations.get(content)?.cancel()
  content.style.color = 'var(--destructive)'

  const keyframes: Keyframe[] = reducedMotion
    ? [{ opacity: 1 }, { opacity: 1 }]
    : [
        { transform: 'translateX(0)' },
        { transform: 'translateX(-2.5px)', offset: 0.18 },
        { transform: 'translateX(2px)', offset: 0.38 },
        { transform: 'translateX(-1.5px)', offset: 0.58 },
        { transform: 'translateX(1px)', offset: 0.76 },
        { transform: 'translateX(0)' },
      ]
  const animation = content.animate(keyframes, {
    duration: reducedMotion ? 240 : 320,
    easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
  })

  activeAnimations.set(content, animation)
  void animation.finished
    .catch(() => undefined)
    .finally(() => {
      if (activeAnimations.get(content) !== animation) return
      activeAnimations.delete(content)
      content.style.removeProperty('color')
    })
}
