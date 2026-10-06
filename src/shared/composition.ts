import type { Composition } from './types'

export function compositionRect(sourceWidth: number, sourceHeight: number, width: number, height: number, composition: Composition) {
  const scale = Math.max(width / sourceWidth, height / sourceHeight) * composition.zoom
  const w = Math.max(1, Math.round(sourceWidth * scale))
  const h = Math.max(1, Math.round(sourceHeight * scale))
  return { width: w, height: h, left: Math.round((width - w) / 2 + composition.offsetX * width), top: Math.round((height - h) / 2 + composition.offsetY * height) }
}
