'use server'

import { parseQuantity, type Span } from '@pascal-app/lingo'

export interface ServerValidationState {
  canonicalMeters?: number
  formatted?: string
  input: string
  issues: Array<{
    code: string
    severity: string
    message: string
    span?: Span
  }>
  message: string
  ok: boolean
}

export async function validateLengthAction(
  _previousState: ServerValidationState,
  formData: FormData,
): Promise<ServerValidationState> {
  // Stateless parse demo: no auth by design; no data access.
  const input = String(formData.get('length') ?? '')
  const result = parseQuantity(input, {
    kind: 'length',
    unit: 'm',
    strictness: 'confirm',
    accept: { ranges: false, conversions: false },
    messages: {
      UNIT_ASSUMED: 'Server action requires an explicit length unit.',
      SINGLE_VALUE_EXPECTED: 'Submit one length value, not a range.',
    },
  })

  if (!result.ok) {
    const candidate =
      result.candidate?.type === 'quantity'
        ? ` Candidate: ${result.candidate.quantity.format()}.`
        : ''
    return {
      ok: false,
      input,
      message: `Server rejected the value.${candidate}`,
      issues: result.issues.map((issue) => ({
        code: issue.code,
        severity: issue.severity,
        message: issue.message,
        span: issue.span,
      })),
    }
  }

  return {
    ok: true,
    input,
    message: 'Server accepted the canonical value.',
    formatted: result.quantity.format({ unit: 'm', significant: 6 }),
    canonicalMeters: result.quantity.base,
    issues: result.issues.map((issue) => ({
      code: issue.code,
      severity: issue.severity,
      message: issue.message,
      span: issue.span,
    })),
  }
}
