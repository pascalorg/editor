export type Rgb = [number, number, number]

/** `#rrggbb` as linear RGB, by a polynomial close to the sRGB curve (no `pow`). */
export function linearColor(hex: string): Rgb {
  const value = Number.parseInt(hex.slice(1), 16)
  const channel = (c: number) => c * (c * (c * 0.305306011 + 0.682171111) + 0.012522878)
  return [
    channel(((value >> 16) & 255) / 255),
    channel(((value >> 8) & 255) / 255),
    channel((value & 255) / 255),
  ]
}
