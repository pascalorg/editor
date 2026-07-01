export function withOpacity(color: string, opacity: number | undefined) {
  const alpha = clamp01(opacity ?? 1)
  if (alpha >= 1) return color

  const hex = normalizeHex(color)
  if (!hex) return color

  const value = Number.parseInt(hex, 16)
  const r = (value >> 16) & 255
  const g = (value >> 8) & 255
  const b = value & 255
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 1))
}

function normalizeHex(color: string) {
  const trimmed = color.trim()
  const short = /^#([0-9a-f]{3})$/i.exec(trimmed)
  if (short) {
    const digits = short[1]
    if (!digits) return null
    return digits
      .split('')
      .map((part) => part + part)
      .join('')
  }

  return /^#([0-9a-f]{6})$/i.exec(trimmed)?.[1] ?? null
}
