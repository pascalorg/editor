/**
 * Navigation helpers for property-based routing
 */

export function getEditorUrl(propertyId: string): string {
  return `/editor/${propertyId}`
}

export function getViewerUrl(propertyId: string): string {
  return `/viewer/${propertyId}`
}

export function getHomeUrl(): string {
  return '/'
}
