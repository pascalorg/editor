import { describe, expect, test } from 'bun:test'
import {
  buildReviewTemplate,
  mergeReviewWithRaw,
  reviewFileNameFor,
  summarizeReviews,
  validateReview,
  type Review,
} from './review-schema'

function completeReview(overrides: Partial<Review> = {}): Review {
  return {
    caseId: 'case-02-studio',
    repeatIndex: 1,
    sceneId: '05aa107b5e82',
    verdict: 'PASS',
    scores: {
      requirementFit: 5,
      layout: 3,
      circulation: 3,
      doorsAndWindows: 4,
      furniture: 3,
      overallRealism: 3,
    },
    issues: [{ tag: 'poor_circulation', severity: 'major', target: '卧室', note: '连接不合理' }],
    reviewerNote: '房间齐全，但动线需要优化',
    reviewedAt: '2026-07-03T12:00:00+09:00',
    ...overrides,
  }
}

describe('buildReviewTemplate / validateReview', () => {
  test('a fresh template validates clean but is pending', () => {
    const template = buildReviewTemplate({ caseId: 'case-01', repeatIndex: 1, sceneId: 'abc' })
    const result = validateReview(template)
    expect(result.errors).toEqual([])
    expect(result.pending).toBe(true)
  })

  test('a complete review is valid and not pending', () => {
    const result = validateReview(completeReview())
    expect(result.errors).toEqual([])
    expect(result.pending).toBe(false)
  })

  test('an out-of-range score is a structural error', () => {
    const result = validateReview(completeReview({ scores: { ...completeReview().scores, layout: 9 } }))
    expect(result.pending).toBe(false)
    expect(result.errors.some(e => e.includes('scores.layout'))).toBe(true)
  })

  test('a bad verdict is flagged', () => {
    const result = validateReview({ ...completeReview(), verdict: 'MAYBE' as unknown as Review['verdict'] })
    expect(result.errors.some(e => e.includes('verdict'))).toBe(true)
  })

  test('a bad issue severity is flagged', () => {
    const bad = completeReview({ issues: [{ tag: 't', severity: 'blocker' as unknown as 'major' }] })
    const result = validateReview(bad)
    expect(result.errors.some(e => e.includes('severity'))).toBe(true)
  })
})

describe('reviewFileNameFor', () => {
  test('only appends .review before .json', () => {
    expect(reviewFileNameFor('case-01-single-room-run1.json')).toBe('case-01-single-room-run1.review.json')
  })
})

describe('mergeReviewWithRaw / summarizeReviews', () => {
  const raw = {
    caseId: 'case-02-studio',
    repeatIndex: 1,
    sceneId: '05aa107b5e82',
    ok: true,
    workflowCompleted: true,
    assertionsPassed: true,
    finalPhase: 'completed_with_issues',
    sceneResult: { remainingIssueCount: 2 },
  }

  test('merges a complete review', () => {
    const merged = mergeReviewWithRaw(raw, completeReview())
    expect(merged.reviewPending).toBe(false)
    expect(merged.review?.verdict).toBe('PASS')
    expect(merged.auto.remainingIssueCount).toBe(2)
  })

  test('a pending template merges as review=null, pending=true', () => {
    const template = buildReviewTemplate({ caseId: 'case-02-studio', repeatIndex: 1, sceneId: 'x' })
    const merged = mergeReviewWithRaw(raw, template)
    expect(merged.review).toBeNull()
    expect(merged.reviewPending).toBe(true)
    expect(merged.reviewErrors).toEqual([])
  })

  test('summary averages scores and collects GOOD baselines', () => {
    const good = mergeReviewWithRaw(raw, completeReview({ verdict: 'GOOD' }))
    const pass = mergeReviewWithRaw(
      { ...raw, caseId: 'case-01', sceneId: 'sc1' },
      completeReview({ caseId: 'case-01', sceneId: 'sc1', verdict: 'PASS' }),
    )
    const summary = summarizeReviews([good, pass])
    expect(summary.reviewed).toBe(2)
    expect(summary.verdictCounts).toEqual({ GOOD: 1, PASS: 1 })
    expect(summary.avgScores.requirementFit).toBe(5)
    expect(summary.baselines).toEqual([{ caseId: 'case-02-studio', repeatIndex: 1, sceneId: '05aa107b5e82' }])
  })
})
