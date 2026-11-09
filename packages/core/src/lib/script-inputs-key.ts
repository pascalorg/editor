/** 32-bit FNV-1a: a change detector for a script's inputs, not a content address. */
function fnv1a(text: string, seed: number): string {
  let hash = seed
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/** The key a finish script keeps of what it was built for, from its inputs' text. */
export function scriptInputsKey(text: string): string {
  return fnv1a(text, 0x811c9dc5) + fnv1a(text, 0x050c5d1f)
}
