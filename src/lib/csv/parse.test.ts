import { describe, it, expect } from 'vitest'
import { parseCsv, parseCsvWithHeader } from './parse'

describe('parseCsv', () => {
  it('parses simple rows', () => {
    expect(parseCsv('a,b,c\n1,2,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ])
  })

  it('handles quoted fields with embedded commas', () => {
    expect(parseCsv('name,note\n"Smith, Jane",hello')).toEqual([
      ['name', 'note'],
      ['Smith, Jane', 'hello'],
    ])
  })

  it('handles escaped quotes (RFC-4180 "")', () => {
    expect(parseCsv('say\n"she said ""hi"""')).toEqual([['say'], ['she said "hi"']])
  })

  it('handles embedded newlines inside quotes', () => {
    expect(parseCsv('a,b\n"line1\nline2",x')).toEqual([
      ['a', 'b'],
      ['line1\nline2', 'x'],
    ])
  })

  it('handles CRLF line endings', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('preserves empty fields', () => {
    expect(parseCsv('a,,c\n,,')).toEqual([
      ['a', '', 'c'],
      ['', '', ''],
    ])
  })

  it('tolerates a trailing newline without an empty extra row', () => {
    expect(parseCsv('a,b\n1,2\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('returns [] for empty input', () => {
    expect(parseCsv('')).toEqual([])
  })
})

describe('parseCsvWithHeader', () => {
  it('keys rows by the header', () => {
    expect(parseCsvWithHeader('name,email\nJane,jane@x.com\nBo,bo@x.com')).toEqual([
      { name: 'Jane', email: 'jane@x.com' },
      { name: 'Bo', email: 'bo@x.com' },
    ])
  })

  it('fills short rows with empty strings and drops extra fields', () => {
    expect(parseCsvWithHeader('a,b,c\n1\n1,2,3,4')).toEqual([
      { a: '1', b: '', c: '' },
      { a: '1', b: '2', c: '3' },
    ])
  })

  it('returns [] when there is no header row', () => {
    expect(parseCsvWithHeader('')).toEqual([])
  })
})
