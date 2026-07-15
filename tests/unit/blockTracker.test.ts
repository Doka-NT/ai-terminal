// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it, vi } from 'vitest'
import type { IMarker, Terminal } from '@xterm/xterm'
import {
  BlockTracker,
  hasCommandText,
  remapRestored633ENonce,
  type BlockTrackerActivity,
  type CommandBlock
} from '../../src/renderer/src/utils/blockTracker'

function createTracker(nonce = 'nonce'): {
  tracker: BlockTracker
  handlers: Map<number, (data: string) => boolean>
  activities: BlockTrackerActivity[]
  onChange: ReturnType<typeof vi.fn>
} {
  const handlers = new Map<number, (data: string) => boolean>()
  const activities: BlockTrackerActivity[] = []
  const onChange = vi.fn()
  let line = 0
  const terminal = {
    parser: {
      registerOscHandler: (code: number, handler: (data: string) => boolean) => {
        handlers.set(code, handler)
        return { dispose: vi.fn() }
      }
    },
    registerMarker: () => {
      const marker = {
        line: line++,
        isDisposed: false,
        dispose() { this.isDisposed = true }
      }
      return marker as unknown as IMarker
    },
    buffer: {
      active: {
        length: 10,
        getLine: () => undefined
      }
    }
  } as unknown as Terminal

  const tracker = new BlockTracker(
    terminal,
    'session-1',
    nonce,
    onChange,
    (activity) => activities.push(activity)
  )
  return { tracker, handlers, activities, onChange }
}

describe('BlockTracker activity', () => {
  it('reports idle at a prompt and running while a command produces output', () => {
    const { handlers, activities, onChange } = createTracker()
    const handle133 = handlers.get(133)

    expect(handle133?.('A')).toBe(true)
    expect(handle133?.('B')).toBe(true)
    expect(handle133?.('C')).toBe(true)
    expect(handle133?.('D;0')).toBe(true)

    expect(activities).toEqual(['idle', 'running', 'idle'])
    expect(onChange).toHaveBeenCalledOnce()
  })

  it('returns to idle when a new prompt finalizes a block without D', () => {
    const { handlers, activities, onChange, tracker } = createTracker()
    const handle133 = handlers.get(133)

    handle133?.('A')
    handle133?.('C')
    handle133?.('A')

    expect(activities).toEqual(['idle', 'running', 'idle'])
    expect(onChange).toHaveBeenCalledOnce()
    expect(tracker.getBlocks()).toHaveLength(1)
  })

  it('bounds an interrupted block (no D) to the next prompt instead of the live buffer end', () => {
    const { handlers, tracker } = createTracker()
    const handle133 = handlers.get(133)

    handle133?.('A')
    handle133?.('C')
    handle133?.('A') // Ctrl-C interrupts before D fires

    const block = tracker.getBlocks()[0]
    expect(block.end).toBeDefined()
    expect(block.end?.isDisposed).toBe(false)
    // Bounded to just before the new prompt, not the mock buffer's length (10).
    expect(tracker.blockRange(block)).toEqual({ start: 1, end: 1 })
  })
})

describe('BlockTracker command metadata', () => {
  it('keeps live nonce validation strict', () => {
    const { tracker, handlers } = createTracker('current-nonce')

    handlers.get(133)?.('A')
    handlers.get(633)?.('E;echo forged;old-nonce')
    handlers.get(133)?.('C')
    handlers.get(133)?.('D;0')

    expect(tracker.getBlocks()[0]?.command).toBe('')

    handlers.get(133)?.('A')
    handlers.get(633)?.('E;echo trusted;current-nonce')
    handlers.get(133)?.('C')
    handlers.get(133)?.('D;0')

    expect(tracker.getBlocks()[1]?.command).toBe('echo trusted')
  })

  it('remaps only exact old nonces in trusted restored output', () => {
    const restored = [
      'before',
      '\x1b]633;E;echo one;old-nonce\x07',
      '\x1b]633;E;echo two;other-nonce\x1b\\',
      '\x1b]633;P;Cwd=/tmp\x07',
      'after'
    ].join('')

    expect(remapRestored633ENonce(restored, 'old-nonce', 'new-nonce')).toBe([
      'before',
      '\x1b]633;E;echo one;new-nonce\x07',
      '\x1b]633;E;echo two;other-nonce\x1b\\',
      '\x1b]633;P;Cwd=/tmp\x07',
      'after'
    ].join(''))
    expect(remapRestored633ENonce(restored, undefined, 'new-nonce')).toBe(restored)
  })

  it('restores command text after nonce rotation without relaxing live validation', () => {
    const { tracker, handlers } = createTracker('new-nonce')
    const restored = remapRestored633ENonce(
      '\x1b]633;E;printf old\\x3b command;old-nonce\x07',
      'old-nonce',
      'new-nonce'
    )
    const payload = restored.slice('\x1b]633;'.length, -1)

    handlers.get(133)?.('A')
    handlers.get(633)?.(payload)
    handlers.get(133)?.('C')
    handlers.get(133)?.('D;0')

    expect(tracker.getBlocks()[0]?.command).toBe('printf old; command')
  })

  it('decodes a literal backslash before delimiter escapes, matching hook encode order', () => {
    const { tracker, handlers } = createTracker('nonce')

    // Real command: printf '\x3b'. The shell hook escapes the literal backslash
    // first (\ -> \\), so the wire payload carries two backslashes before x3b.
    handlers.get(133)?.('A')
    handlers.get(633)?.("E;printf '\\\\x3b';nonce")
    handlers.get(133)?.('C')
    handlers.get(133)?.('D;0')

    expect(tracker.getBlocks()[0]?.command).toBe("printf '\\x3b'")
  })

  it('reports whether command-dependent actions have usable text', () => {
    expect(hasCommandText({ command: '  pwd  ' })).toBe(true)
    expect(hasCommandText({ command: '  ' })).toBe(false)
  })

  it('omits a fake prompt from block text when command metadata is unavailable', () => {
    const { tracker, handlers } = createTracker()
    handlers.get(133)?.('A')
    handlers.get(133)?.('C')
    handlers.get(133)?.('D;0')
    const block = tracker.getBlocks()[0]

    expect(tracker.blockFullText(block)).toBe('')
    expect(tracker.blockFullText(block)).not.toContain('$ ')
  })
})

describe('BlockTracker output range', () => {
  function marker(line: number): IMarker {
    const m = { line, isDisposed: false, dispose() { this.isDisposed = true } }
    return m as unknown as IMarker
  }

  function mockLine(text: string, isWrapped = false): { isWrapped: boolean; translateToString: (trimRight?: boolean, startColumn?: number, endColumn?: number) => string } {
    return {
      isWrapped,
      translateToString: (trimRight, startColumn = 0, endColumn = text.length) => {
        const slice = text.slice(startColumn, endColumn)
        return trimRight ? slice.replace(/\s+$/, '') : slice
      }
    }
  }

  it('treats a same-row marker pair (zero-output command) as empty, not the next prompt row', () => {
    const rowText: Record<number, string> = { 5: 'user@host:~$ ' }
    const terminal = {
      parser: { registerOscHandler: () => ({ dispose: vi.fn() }) },
      registerMarker: () => marker(0),
      buffer: {
        active: {
          length: 10,
          getLine: (row: number) => rowText[row] !== undefined
            ? { translateToString: () => rowText[row] }
            : undefined
        }
      }
    } as unknown as Terminal

    const tracker = new BlockTracker(terminal, 'session-1', 'nonce', vi.fn(), vi.fn())

    // Simulates OSC 133;C and 133;D both landing on row 5 — a command like
    // `true` or `cd` that produces no output before the next prompt renders.
    const block: CommandBlock = {
      id: 'b1',
      sessionId: 'session-1',
      promptStart: marker(3),
      commandStart: marker(4),
      outputStart: marker(5),
      end: marker(5),
      command: 'true',
      exitCode: 0,
      quality: 'osc'
    }

    expect(tracker.blockRange(block)).toEqual({ start: 5, end: 4 })
    expect(tracker.blockOutputText(block)).toBe('')
  })

  it('keeps real output that shares a row with the next prompt when there is no trailing newline', () => {
    // e.g. `printf foo`: the D marker lands on the same row as outputStart,
    // but at column 3 (after "foo"), not column 0 — the row already has the
    // next prompt's text appended by the time it's read ("foo$ ").
    const terminal = {
      parser: { registerOscHandler: () => ({ dispose: vi.fn() }) },
      registerMarker: () => marker(0),
      buffer: {
        active: {
          length: 10,
          getLine: (row: number) => row === 5 ? mockLine('foo$ ') : undefined
        }
      }
    } as unknown as Terminal

    const tracker = new BlockTracker(terminal, 'session-1', 'nonce', vi.fn(), vi.fn())
    const block: CommandBlock = {
      id: 'b1',
      sessionId: 'session-1',
      promptStart: marker(3),
      commandStart: marker(4),
      outputStart: marker(5),
      end: marker(5),
      endColumn: 3,
      command: 'printf foo',
      exitCode: 0,
      quality: 'osc'
    }

    expect(tracker.blockRange(block)).toEqual({ start: 5, end: 5, endColumn: 3 })
    expect(tracker.blockOutputText(block)).toBe('foo')

    // The row with real output must also be hoverable/clickable and included
    // in the selection highlight, not just readable via blockOutputText.
    ;(tracker as unknown as { blocks: CommandBlock[] }).blocks.push(block)
    expect(tracker.blockAtRow(5)).toBe(block)
    expect(tracker.blockHighlightRange(block)).toEqual({ start: 3, end: 5 })
  })

  it('rejoins wrapped rows without inserting synthetic newlines', () => {
    const lines: Record<number, ReturnType<typeof mockLine>> = {
      5: mockLine('{"a":1,"b":'),
      6: mockLine('2,"c":3}', true)
    }
    const terminal = {
      parser: { registerOscHandler: () => ({ dispose: vi.fn() }) },
      registerMarker: () => marker(0),
      buffer: {
        active: {
          length: 10,
          getLine: (row: number) => lines[row]
        }
      }
    } as unknown as Terminal

    const tracker = new BlockTracker(terminal, 'session-1', 'nonce', vi.fn(), vi.fn())
    const block: CommandBlock = {
      id: 'b1',
      sessionId: 'session-1',
      promptStart: marker(3),
      commandStart: marker(4),
      outputStart: marker(5),
      end: marker(7),
      command: 'echo json',
      exitCode: 0,
      quality: 'osc'
    }

    expect(tracker.blockOutputText(block)).toBe('{"a":1,"b":2,"c":3}')
  })
})
