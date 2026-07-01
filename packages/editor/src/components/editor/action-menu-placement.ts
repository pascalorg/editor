'use client'

import * as THREE from 'three'

export const ACTION_MENU_DISTANCE_FACTOR = 6

type ActionMenuPlacementRule =
  | 'bbox'
  | 'bbox-tall'
  | 'flat-structure'
  | 'html-compact'
  | 'html-panel'
  | 'linear'

type ActionMenuPlacementNode = { type: string; widgetType?: string }

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

const RULE_BY_NODE_TYPE = new Map<string, ActionMenuPlacementRule>([
  ['data-widget', 'html-compact'],
  ['data-chart', 'html-panel'],
  ['data-table', 'html-panel'],
  ['slab', 'flat-structure'],
  ['ceiling', 'flat-structure'],
  ['wall', 'linear'],
  ['fence', 'linear'],
  ['pipe', 'linear'],
  ['conveyor-belt', 'linear'],
  ['cable-tray', 'linear'],
  ['road', 'linear'],
  ['steel-beam', 'linear'],
])

function getPlacementRule(
  node: ActionMenuPlacementNode,
  size: THREE.Vector3,
): ActionMenuPlacementRule {
  if (node.type === 'data-widget' && (node.widgetType === 'card' || node.widgetType === 'chart')) {
    return 'html-panel'
  }

  const explicitRule = RULE_BY_NODE_TYPE.get(node.type)
  if (explicitRule) return explicitRule
  return size.y > 4 ? 'bbox-tall' : 'bbox'
}

function getAnchorGap(rule: ActionMenuPlacementRule, size: THREE.Vector3) {
  switch (rule) {
    case 'html-compact':
      return 0.24
    case 'html-panel':
      return 0.5
    case 'bbox-tall':
      return 0.24
    case 'flat-structure':
      return 0.5
    case 'linear':
      return 0.22
    case 'bbox':
      return clamp(size.y * 0.08, 0.18, 0.32)
  }
}

export function getActionMenuAnchor(
  node: ActionMenuPlacementNode,
  box: THREE.Box3,
  target: THREE.Vector3,
  sizeTarget = new THREE.Vector3(),
) {
  const size = box.getSize(sizeTarget)
  const center = box.getCenter(target)
  const rule = getPlacementRule(node, size)
  const yBase = rule === 'html-compact' ? center.y : box.max.y

  return target.set(center.x, yBase + getAnchorGap(rule, size), center.z)
}
