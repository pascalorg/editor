'use client'

import { EDITOR_LAYER } from '@pascal-app/editor'
import { Children, type ReactNode, useEffect, useMemo } from 'react'
import { CanvasTexture, SRGBColorSpace } from 'three'

const PIXELS_PER_METER = 2048
const FONT_FAMILY = 'Inter, ui-sans-serif, system-ui, sans-serif'

function wrapLines(context: CanvasRenderingContext2D, text: string, maxWidth?: number) {
  const paragraphs = text.split('\n')
  if (!maxWidth) return paragraphs

  const lines: string[] = []
  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean)
    if (words.length === 0) {
      lines.push('')
      continue
    }

    let line = words[0]!
    for (const word of words.slice(1)) {
      const candidate = `${line} ${word}`
      if (context.measureText(candidate).width <= maxWidth) line = candidate
      else {
        lines.push(line)
        line = word
      }
    }
    lines.push(line)
  }
  return lines
}

export function SpatialText({
  anchorX = 'center',
  anchorY = 'middle',
  children,
  color,
  fontSize,
  maxWidth,
  position,
  renderOrder = 6,
  textAlign = 'center',
}: {
  anchorX?: 'center' | 'left' | 'right'
  anchorY?: 'bottom' | 'middle' | 'top'
  children: ReactNode
  color: string
  fontSize: number
  maxWidth?: number
  position: [number, number, number]
  renderOrder?: number
  textAlign?: 'center' | 'left' | 'right'
}) {
  const text = Children.toArray(children).join('')
  const rendered = useMemo(() => {
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    if (!context) return null

    const fontPixels = Math.max(12, Math.round(fontSize * PIXELS_PER_METER))
    const lineHeight = Math.ceil(fontPixels * 1.2)
    const padding = Math.ceil(fontPixels * 0.12)
    context.font = `600 ${fontPixels}px ${FONT_FAMILY}`
    const lines = wrapLines(
      context,
      text,
      maxWidth ? Math.round(maxWidth * PIXELS_PER_METER) : undefined,
    )
    const measuredWidth = Math.max(1, ...lines.map((line) => context.measureText(line).width))
    canvas.width = Math.ceil(measuredWidth + padding * 2)
    canvas.height = Math.ceil(lines.length * lineHeight + padding * 2)

    context.font = `600 ${fontPixels}px ${FONT_FAMILY}`
    context.fillStyle = color
    context.textAlign = textAlign
    context.textBaseline = 'top'
    const x =
      textAlign === 'left'
        ? padding
        : textAlign === 'right'
          ? canvas.width - padding
          : canvas.width / 2
    lines.forEach((line, index) => {
      context.fillText(line, x, padding + index * lineHeight)
    })

    const texture = new CanvasTexture(canvas)
    texture.colorSpace = SRGBColorSpace
    return {
      height: canvas.height / PIXELS_PER_METER,
      texture,
      width: canvas.width / PIXELS_PER_METER,
    }
  }, [color, fontSize, maxWidth, text, textAlign])

  useEffect(() => () => rendered?.texture.dispose(), [rendered])
  if (!rendered) return null

  const offsetX =
    anchorX === 'left' ? rendered.width / 2 : anchorX === 'right' ? -rendered.width / 2 : 0
  const offsetY =
    anchorY === 'top' ? -rendered.height / 2 : anchorY === 'bottom' ? rendered.height / 2 : 0

  return (
    <mesh
      layers={EDITOR_LAYER}
      position={[position[0] + offsetX, position[1] + offsetY, position[2]]}
      renderOrder={renderOrder}
      raycast={() => undefined}
    >
      <planeGeometry args={[rendered.width, rendered.height]} />
      <meshBasicMaterial
        alphaTest={0.02}
        depthWrite={false}
        map={rendered.texture}
        toneMapped={false}
        transparent
      />
    </mesh>
  )
}
