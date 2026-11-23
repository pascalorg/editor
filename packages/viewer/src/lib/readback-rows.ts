/** WebGPU's `copyTextureToBuffer` aligns every row to this many bytes. */
const WEBGPU_ROW_ALIGNMENT = 256

/**
 * An RGBA8 render-target readback as tightly packed, top-down rows (what
 * `ImageData` wants). Three shapes come back:
 * - WebGPU, three before r187: top-down, each row padded to 256 bytes when
 *   width × 4 isn't already a multiple of 256.
 * - WebGPU, three r187+: top-down and already tight (three strips the padding).
 * - WebGL2 fallback (iOS Chrome, etc.): tight but bottom-up (the framebuffer
 *   convention).
 * The WebGPU padding is settled by the buffer's exact length, not assumed:
 * depadding a tight buffer (or reading a padded one tight) walks every row
 * sideways and shears the frame into horizontal streaks.
 */
export function readbackRows(
  pixels: Uint8Array,
  width: number,
  height: number,
  isWebGPU: boolean,
): Uint8ClampedArray {
  const tightBytesPerRow = width * 4
  const tightTotal = tightBytesPerRow * height
  const paddedBytesPerRow =
    Math.ceil(tightBytesPerRow / WEBGPU_ROW_ALIGNMENT) * WEBGPU_ROW_ALIGNMENT
  const stride =
    isWebGPU && pixels.byteLength === paddedBytesPerRow * height
      ? paddedBytesPerRow
      : tightBytesPerRow
  if (isWebGPU && stride === tightBytesPerRow) {
    return new Uint8ClampedArray(
      pixels.buffer,
      pixels.byteOffset,
      Math.min(pixels.byteLength, tightTotal),
    )
  }
  const rows = new Uint8ClampedArray(tightTotal)
  for (let row = 0; row < height; row++) {
    const source = (isWebGPU ? row : height - 1 - row) * stride
    rows.set(pixels.subarray(source, source + tightBytesPerRow), row * tightBytesPerRow)
  }
  return rows
}
