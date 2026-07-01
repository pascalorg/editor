export type RegistryHtmlDragOrigin = {
  nodeId: string
  clientX: number
  clientY: number
}

export const registryHtmlDragOriginRef: { current: RegistryHtmlDragOrigin | null } = {
  current: null,
}

export function setRegistryHtmlDragOrigin(
  nodeId: string,
  point: { clientX: number; clientY: number },
) {
  registryHtmlDragOriginRef.current = {
    nodeId,
    clientX: point.clientX,
    clientY: point.clientY,
  }
}

export function getRegistryHtmlDragOrigin(nodeId: string): RegistryHtmlDragOrigin | null {
  const origin = registryHtmlDragOriginRef.current
  return origin?.nodeId === nodeId ? origin : null
}

export function clearRegistryHtmlDragOrigin(nodeId: string) {
  if (registryHtmlDragOriginRef.current?.nodeId === nodeId) {
    registryHtmlDragOriginRef.current = null
  }
}
