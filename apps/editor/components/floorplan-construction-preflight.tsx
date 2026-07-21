'use client'

import { useScene } from '@pascal-app/core'
import { useFloorplanPreflight } from '@pascal-app/editor'
import {
  buildClearanceAdvisories,
  buildConstructionModuleAdvisories,
  buildDimensionCompletenessAudit,
} from '@pascal-app/nodes'
import { useEffect, useMemo } from 'react'

export function FloorplanConstructionPreflight() {
  const nodes = useScene((state) => state.nodes)
  const clearanceChecksEnabled = useFloorplanPreflight((state) => state.clearanceChecksEnabled)
  const moduleChecksEnabled = useFloorplanPreflight((state) => state.moduleChecksEnabled)
  const setAuditIssues = useFloorplanPreflight((state) => state.setAuditIssues)

  const issues = useMemo(() => {
    const completeness = buildDimensionCompletenessAudit(nodes, {
      includeAutomaticDimensions: true,
    }).map((issue) => ({
      id: issue.id,
      kind: 'dimension-completeness' as const,
      severity: issue.severity,
      message: issue.message,
    }))
    const clearance = clearanceChecksEnabled
      ? buildClearanceAdvisories(nodes, { includeDisabled: true }).map((issue) => ({
          id: issue.id,
          kind: 'clearance-advisory' as const,
          severity: issue.severity,
          message: issue.message,
        }))
      : []
    const modules = moduleChecksEnabled
      ? buildConstructionModuleAdvisories(nodes, { includeDisabled: true }).map((issue) => ({
          id: issue.id,
          kind: 'module-advisory' as const,
          severity: issue.severity,
          message: issue.message,
        }))
      : []
    return [...completeness, ...clearance, ...modules]
  }, [clearanceChecksEnabled, moduleChecksEnabled, nodes])

  useEffect(() => {
    setAuditIssues(issues)
    return () => setAuditIssues([])
  }, [issues, setAuditIssues])

  return null
}
