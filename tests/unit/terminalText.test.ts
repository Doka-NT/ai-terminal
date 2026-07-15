// SPDX-License-Identifier: MPL-2.0
import { boundTerminalOutputForRequest, decodeShellIntegrationCommand, stripAnsi, trimTerminalOutputBuffer } from '@shared/terminalText'

describe('stripAnsi', () => {
  it('removes full OSC sequences terminated by BEL, including shell-integration markers', () => {
    expect(stripAnsi('before\x1b]633;E;echo hi;nonce-value\x07after')).toBe('beforeafter')
    expect(stripAnsi('before\x1b]133;A\x07after')).toBe('beforeafter')
  })

  it('removes OSC sequences terminated by ST (ESC \\\\)', () => {
    expect(stripAnsi('before\x1b]633;P;Cwd=/tmp\x1b\\after')).toBe('beforeafter')
  })

  it('removes CSI sequences without touching plain text', () => {
    expect(stripAnsi('\x1b[31mred\x1b[0m text')).toBe('red text')
  })

  it('leaves plain text untouched', () => {
    expect(stripAnsi('plain output\nwith lines')).toBe('plain output\nwith lines')
  })

  it('does not swallow real text between two separate ST-terminated OSC sequences', () => {
    // A greedy match here would run from the first ESC] through the LAST
    // terminator, deleting `visible` along with both title-setting sequences.
    expect(stripAnsi('\x1b]0;a\x1b\\visible\x1b]0;b\x1b\\')).toBe('visible')
  })

  it('does not swallow real text between two separate BEL-terminated OSC sequences', () => {
    expect(stripAnsi('\x1b]0;a\x07visible\x1b]0;b\x07')).toBe('visible')
  })
})

describe('decodeShellIntegrationCommand', () => {
  it('decodes escaped delimiters', () => {
    expect(decodeShellIntegrationCommand('a\\x3bb')).toBe('a;b')
    expect(decodeShellIntegrationCommand('a\\x0ab')).toBe('a\nb')
    expect(decodeShellIntegrationCommand('a\\x0db')).toBe('a\rb')
  })

  it('decodes an escaped literal backslash', () => {
    expect(decodeShellIntegrationCommand('a\\\\b')).toBe('a\\b')
  })

  it('round-trips a command whose literal text looks like a delimiter escape', () => {
    // Real command: printf '\x3b' — the shell hook escapes the literal backslash
    // first (\ -> \\), so the wire payload is `printf '\\x3b'` (two backslashes).
    // A naive decoder that resolves \x3b before \\ would corrupt this to `printf '\;'`.
    expect(decodeShellIntegrationCommand("printf '\\\\x3b'")).toBe("printf '\\x3b'")
  })

  it('round-trips a trailing literal backslash', () => {
    expect(decodeShellIntegrationCommand('echo foo\\\\')).toBe('echo foo\\')
  })

  it('leaves an unrecognized backslash sequence untouched', () => {
    expect(decodeShellIntegrationCommand('a\\zb')).toBe('a\\zb')
  })
})

describe('boundTerminalOutputForRequest', () => {
  it('strips a full OSC sequence before bounding, even when slicing first would bisect it', () => {
    const nonce = 'MY-NONCE-VALUE'
    const oscBody = `633;E;ls;${nonce}\x07`
    const tail = 'AFTER-TAIL-TEXT'
    const raw = 'x'.repeat(50) + '\x1b]' + oscBody + tail
    const maxChars = oscBody.length + tail.length // lands exactly after the ESC] prefix

    // Sanity check: slicing the raw buffer first (the old, buggy order) leaves a
    // headless OSC fragment that stripAnsi can no longer recognize as an escape.
    expect(raw.slice(-maxChars)).toBe(oscBody + tail)
    expect(stripAnsi(raw.slice(-maxChars))).toContain(nonce)

    const result = boundTerminalOutputForRequest(raw, maxChars)
    expect(result).not.toContain(nonce)
    expect(result).toContain('AFTER-TAIL-TEXT')
  })

  it('returns undefined when there is nothing left after stripping and bounding', () => {
    expect(boundTerminalOutputForRequest('', 100)).toBeUndefined()
    expect(boundTerminalOutputForRequest('\x1b]633;E;ls;nonce\x07', 100)).toBeUndefined()
  })
})

describe('trimTerminalOutputBuffer', () => {
  it('returns the value unchanged when already within the limit', () => {
    expect(trimTerminalOutputBuffer('short', 100)).toBe('short')
  })

  it('performs the naive cut unchanged when it does not land inside an OSC sequence', () => {
    const marker = '\x1b]633;E;ls;nonce\x07'
    const value = marker + 'x'.repeat(100)
    expect(trimTerminalOutputBuffer(value, 50)).toBe(value.slice(-50))
  })

  it('moves the cut before a BEL-terminated OSC sequence the naive cut would bisect', () => {
    const marker = '\x1b]633;E;ls;NONCE\x07'
    const value = 'x'.repeat(50) + marker + 'TAIL'
    const targetCutAt = 60 // lands inside the marker's payload, after "ls;"
    const maxChars = value.length - targetCutAt

    // Sanity check: the naive cut really does bisect the marker, leaving a
    // headless fragment with part of the nonce and no ESC] prefix.
    expect(value.slice(-maxChars)).toBe(';NONCE\x07TAIL')

    expect(trimTerminalOutputBuffer(value, maxChars)).toBe(marker + 'TAIL')
  })

  it('moves the cut before an ST-terminated OSC sequence the naive cut would bisect', () => {
    const marker = '\x1b]0;title-text\x1b\\'
    const value = 'x'.repeat(50) + marker + 'TAIL'
    // Land the cut one byte into the ST terminator's two bytes (ESC + \).
    const targetCutAt = 50 + marker.length - 1
    const maxChars = value.length - targetCutAt

    expect(value.slice(-maxChars)).toBe('\\TAIL')

    expect(trimTerminalOutputBuffer(value, maxChars)).toBe(marker + 'TAIL')
  })

  it('falls back to the naive cut when the nearest OSC introducer is beyond the lookback window', () => {
    const marker = '\x1b]0;unterminated-marker-with-no-terminator-at-all'
    const value = marker + 'y'.repeat(20000)
    expect(trimTerminalOutputBuffer(value, 100)).toBe(value.slice(-100))
  })
})
