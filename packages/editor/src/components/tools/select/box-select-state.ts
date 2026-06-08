export let boxSelectHandled = false

let resetTimeout: ReturnType<typeof setTimeout> | null = null

export function markBoxSelectHandled() {
  boxSelectHandled = true
  if (resetTimeout) {
    clearTimeout(resetTimeout)
  }
  resetTimeout = setTimeout(() => {
    boxSelectHandled = false
    resetTimeout = null
  }, 50)
}

export function clearBoxSelectHandled() {
  if (resetTimeout) {
    clearTimeout(resetTimeout)
    resetTimeout = null
  }
  boxSelectHandled = false
}
