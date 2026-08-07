import { describe, expect, test } from 'bun:test'
import { TerminalProgress } from './terminal-progress.js'

describe('terminal progress', () => {
  test('prints durable stage feedback outside a TTY', () => {
    const chunks: string[] = []
    const progress = new TerminalProgress({
      isTTY: false,
      write(chunk) {
        chunks.push(chunk)
      },
    })

    progress.start('Installing the editor runtime')
    progress.update('Checking that the editor is ready')
    progress.succeed('Pascal Editor is ready')

    expect(chunks.join('')).toBe(
      '• Installing the editor runtime\n' +
        '• Checking that the editor is ready\n' +
        '✓ Pascal Editor is ready\n',
    )
  })
})
