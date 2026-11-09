export function installImmediateAnimationFrames(): () => void {
  const names = ['requestAnimationFrame', 'cancelAnimationFrame'] as const
  const previous = names.map((name) => Object.getOwnPropertyDescriptor(globalThis, name))
  globalThis.requestAnimationFrame = (callback) => {
    callback(0)
    return 0
  }
  globalThis.cancelAnimationFrame = () => {}
  return () => {
    for (const [index, name] of names.entries()) {
      const descriptor = previous[index]
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else Reflect.deleteProperty(globalThis, name)
    }
  }
}
