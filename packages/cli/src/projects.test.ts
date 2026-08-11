import { describe, expect, test } from 'bun:test'
import { type LocalProject, resolveLocalProject } from './projects.js'

const projects: LocalProject[] = [
  {
    id: 'kitchen-2026',
    name: 'Kitchen renovation',
    updatedAt: '2026-08-07T16:00:00.000Z',
    version: 3,
    nodeCount: 20,
  },
  {
    id: 'garden-room',
    name: 'Garden room',
    updatedAt: '2026-08-06T16:00:00.000Z',
    version: 1,
    nodeCount: 8,
  },
]

describe('local project selection', () => {
  test('resumes the newest project when no selector is given', () => {
    expect(resolveLocalProject(projects)).toBe(projects[0])
  })

  test('matches an exact id, a unique prefix, or a case-insensitive name', () => {
    expect(resolveLocalProject(projects, 'garden-room')).toBe(projects[1])
    expect(resolveLocalProject(projects, 'kitchen')).toBe(projects[0])
    expect(resolveLocalProject(projects, 'GARDEN ROOM')).toBe(projects[1])
  })

  test('never guesses when a selector is ambiguous', () => {
    const ambiguous = [...projects, { ...projects[1]!, id: 'garden-suite', name: 'Garden room' }]
    expect(() => resolveLocalProject(ambiguous, 'garden')).toThrow(/More than one/)
    expect(() => resolveLocalProject(ambiguous, 'Garden room')).toThrow(/More than one/)
  })

  test('returns an actionable error when no project matches', () => {
    expect(() => resolveLocalProject(projects, 'missing')).toThrow(/No local project matches/)
    expect(() => resolveLocalProject([], undefined)).toThrow(/No local projects exist/)
  })
})
