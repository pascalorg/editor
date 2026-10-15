import { expect, test } from 'bun:test'
import { getProjectFileSink, setProjectFileSink } from '@pascal-app/core'

test('an export keeps its original project destination across navigation', async () => {
  const destinations: string[] = []
  const clearFirst = setProjectFileSink(async () => {
    destinations.push('first')
  })
  const exportDestination = getProjectFileSink()
  const clearNext = setProjectFileSink(async () => {
    destinations.push('next')
  })
  clearFirst()
  try {
    const file = { blob: new Blob(['report']), name: 'Report.txt' }
    await exportDestination?.(file)
    await getProjectFileSink()?.(file)
    expect(destinations).toEqual(['first', 'next'])
  } finally {
    clearNext()
  }
  expect(getProjectFileSink()).toBeNull()
})
