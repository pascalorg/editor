import { describe, expect, it } from 'bun:test'
import { parseImportSrc } from './import-src'

describe('parseImportSrc', () => {
  it('accepts plain https URLs', () => {
    const result = parseImportSrc('https://example.com/scan/pascal.json')
    expect(result.ok).toBe(true)
  })

  it('accepts http for localhost during development', () => {
    expect(parseImportSrc('http://localhost:8080/scene.json').ok).toBe(true)
    expect(parseImportSrc('http://127.0.0.1/scene.json').ok).toBe(true)
  })

  it('rejects http for non-local hosts', () => {
    expect(parseImportSrc('http://example.com/scene.json').ok).toBe(false)
  })

  it('rejects non-http schemes', () => {
    expect(parseImportSrc('javascript:alert(1)').ok).toBe(false)
    expect(parseImportSrc('file:///etc/passwd').ok).toBe(false)
    expect(parseImportSrc('ftp://example.com/x.json').ok).toBe(false)
  })

  it('rejects embedded credentials', () => {
    expect(parseImportSrc('https://user:pass@example.com/x.json').ok).toBe(false)
  })

  it('rejects relative and malformed values', () => {
    expect(parseImportSrc('/scene.json').ok).toBe(false)
    expect(parseImportSrc('').ok).toBe(false)
    expect(parseImportSrc(undefined).ok).toBe(false)
  })
})
