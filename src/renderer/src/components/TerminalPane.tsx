import { useEffect, useRef, type MutableRefObject } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import type { TerminalSessionInfo } from '@shared/types'

interface TerminalPaneProps {
  activeSession?: TerminalSessionInfo & { status: 'running' | 'exited' }
  sessionIds: string[]
  layoutKey: string
  textSize: number
  clearSignal: number
  onSelectionChange: (selection: string) => void
  outputBuffers: MutableRefObject<Map<string, string>>
  onOutput: (sessionId: string, data: string) => void
}

// C1 control characters (U+0080–U+009F) that appear as ?<0080> artifacts
const C1_REGEX = /[-]/g

export function TerminalPane({
  activeSession,
  sessionIds,
  layoutKey,
  textSize,
  clearSignal,
  onSelectionChange,
  outputBuffers,
  onOutput
}: TerminalPaneProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const activeSessionIdRef = useRef<string>()
  const resizeFrameRef = useRef<number>()
  const initialResizeTimerRef = useRef<number>()
  const textSizeRef = useRef(textSize)
  const activeSessionId = activeSession?.id

  useEffect(() => {
    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: '"SFMono-Regular", "JetBrains Mono", Menlo, Consolas, monospace',
      fontSize: textSizeRef.current,
      lineHeight: 1.25,
      macOptionIsMeta: true,
      minimumContrastRatio: 4.5,
      scrollback: 5000,
      theme: {
        background: '#0C0C0E',
        foreground: 'rgba(255,255,255,0.78)',
        cursor: '#E8399A',
        cursorAccent: '#0C0C0E',
        selectionBackground: 'rgba(41,196,232,0.22)',
        selectionForeground: '#ffffff',
        black: '#0C0C0E',
        red: '#F09595',
        green: '#34C759',
        yellow: '#EF9F27',
        blue: '#5BB8EC',
        magenta: '#E8399A',
        cyan: '#29C4E8',
        white: 'rgba(255,255,255,0.78)',
        brightBlack: 'rgba(255,255,255,0.32)',
        brightRed: '#F09595',
        brightGreen: '#34C759',
        brightYellow: '#EF9F27',
        brightBlue: '#5BB8EC',
        brightMagenta: '#E8399A',
        brightCyan: '#29C4E8',
        brightWhite: 'rgba(255,255,255,0.9)'
      }
    })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    ;(terminal as XtermInternals)._aiTerminalFit = fit
    terminalRef.current = terminal
    fitRef.current = fit

    if (containerRef.current) {
      terminal.open(containerRef.current)
      initialResizeTimerRef.current = window.setTimeout(() => {
        if (containerRef.current) {
          scheduleResize(terminal, containerRef.current, activeSessionIdRef.current, resizeFrameRef)
        }
      }, 150)
    }

    const dataDisposable = terminal.onData((data) => {
      const sessionId = activeSessionIdRef.current
      if (sessionId) {
        void window.api.terminal.write(sessionId, data)
      }
    })

    const selectionDisposable = terminal.onSelectionChange(() => {
      onSelectionChange(terminal.getSelection())
    })

    const offTerminalData = window.api.terminal.onData(({ sessionId, data }) => {
      const clean = data.replace(C1_REGEX, '')
      onOutput(sessionId, clean)

      if (sessionId === activeSessionIdRef.current) {
        terminal.write(clean)
      }
    })

    const resizeObserver = new ResizeObserver(() => {
      if (containerRef.current) {
        scheduleResize(terminal, containerRef.current, activeSessionIdRef.current, resizeFrameRef)
      }
    })
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current)
    }

    return () => {
      dataDisposable.dispose()
      selectionDisposable.dispose()
      offTerminalData()
      resizeObserver.disconnect()
      if (initialResizeTimerRef.current) {
        window.clearTimeout(initialResizeTimerRef.current)
        initialResizeTimerRef.current = undefined
      }
      cancelScheduledResize(resizeFrameRef)
      delete (terminal as XtermInternals)._aiTerminalFit
      terminal.dispose()
      fitRef.current = null
    }
  }, [onSelectionChange, onOutput])

  useEffect(() => {
    const terminal = terminalRef.current
    textSizeRef.current = textSize
    if (!terminal) return

    terminal.options.fontSize = textSize
    if (containerRef.current) {
      scheduleResize(terminal, containerRef.current, activeSessionIdRef.current, resizeFrameRef)
    }
  }, [textSize])

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId
    const terminal = terminalRef.current
    if (!terminal) return

    terminal.reset()
    const output = activeSessionId ? outputBuffers.current.get(activeSessionId) ?? '' : ''
    if (activeSessionId && output) {
      terminal.write(output)
    } else if (!activeSessionId) {
      terminal.write('\r\nNo active terminal session.\r\n')
    }

    queueMicrotask(() => {
      if (containerRef.current) {
        scheduleResize(terminal, containerRef.current, activeSessionId, resizeFrameRef)
      }
      if (activeSessionId && terminal.cols > 1 && terminal.rows > 1) {
        void window.api.terminal.resize(activeSessionId, terminal.cols, terminal.rows)
      }
    })
  }, [activeSessionId, outputBuffers])

  useEffect(() => {
    const liveSessionIds = new Set(sessionIds)
    for (const sessionId of outputBuffers.current.keys()) {
      if (!liveSessionIds.has(sessionId)) {
        outputBuffers.current.delete(sessionId)
      }
    }
  }, [sessionIds, outputBuffers])

  useEffect(() => {
    if (clearSignal === 0) return

    terminalRef.current?.clear()
    onSelectionChange('')
  }, [clearSignal, onSelectionChange])

  useEffect(() => {
    const terminal = terminalRef.current
    if (terminal && containerRef.current) {
      scheduleResize(terminal, containerRef.current, activeSessionIdRef.current, resizeFrameRef)
    }
  }, [layoutKey])

  return (
    <div className="terminal-frame">
      <div className="terminal-container" ref={containerRef} />
    </div>
  )
}

function cancelScheduledResize(frameRef: MutableRefObject<number | undefined>): void {
  if (frameRef.current) {
    cancelAnimationFrame(frameRef.current)
    frameRef.current = undefined
  }
}

function scheduleResize(
  terminal: Terminal,
  container: HTMLElement,
  sessionId: string | undefined,
  frameRef: MutableRefObject<number | undefined>,
  attempt = 0
): void {
  cancelScheduledResize(frameRef)

  frameRef.current = requestAnimationFrame(() => {
    frameRef.current = undefined

    if (!hasXtermRenderer(terminal)) {
      if (attempt < 30) {
        scheduleResize(terminal, container, sessionId, frameRef, attempt + 1)
      }
      return
    }

    const rect = container.getBoundingClientRect()
    if (rect.width < 120 || rect.height < 80) return

    const before = { cols: terminal.cols, rows: terminal.rows }
    try {
      fitRefFor(terminal)?.fit()
    } catch {
      if (attempt < 30) {
        scheduleResize(terminal, container, sessionId, frameRef, attempt + 1)
      }
      return
    }

    if (sessionId && (before.cols !== terminal.cols || before.rows !== terminal.rows)) {
      void window.api.terminal.resize(sessionId, terminal.cols, terminal.rows)
    }
  })
}

interface XtermInternals {
  _core?: { _renderService?: { _renderer?: { value?: unknown } } }
  _aiTerminalFit?: FitAddon
}

function hasXtermRenderer(terminal: Terminal): boolean {
  return Boolean((terminal as XtermInternals)._core?._renderService?._renderer?.value)
}

function fitRefFor(terminal: Terminal): FitAddon | undefined {
  return (terminal as XtermInternals)._aiTerminalFit
}
