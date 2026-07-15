// SPDX-License-Identifier: MPL-2.0
import {
  forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState,
  type KeyboardEvent, type MouseEvent, type MutableRefObject, type PointerEvent
} from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import { Terminal } from '@xterm/xterm'
import { BookmarkPlus, ChevronDown, ChevronUp, Copy, FileText, MousePointerClick, Play, Search, Sparkles, SquareCheckBig, SquareTerminal, X } from 'lucide-react'
import type { TerminalCursorStyle } from '@shared/types'
import { useT } from '@renderer/i18n/language'
import type { TerminalColors } from '@renderer/themes/types'
import { getSessionRenderStatus, isLiveSessionStatus, type SessionTabInfo } from '@renderer/utils/sessionTabs'
import { BlockTracker, hasCommandText, type BlockTrackerActivity, type CommandBlock } from '@renderer/utils/blockTracker'
import { outputWithVisibleCursor } from '@renderer/utils/terminalOutput'

interface TerminalPaneProps {
  activeSession?: SessionTabInfo
  sessionIds: string[]
  layoutKey: string
  textSize: number
  fontFamily: string
  cursorStyle: TerminalCursorStyle
  cursorBlink: boolean
  lineHeight: number
  scrollback: number
  clearSignal: number
  onSelectionChange: (selection: string) => void
  outputBuffers: MutableRefObject<Map<string, string>>
  onOutput: (sessionId: string, data: string) => void
  onReconnect: (sessionId: string) => void
  commandBlocks: CommandBlock[]
  selectedBlockIds: string[]
  onToggleBlockSelection: (blockId: string, additive: boolean) => void
  onClearBlockSelection: () => void
  onBlocksChange: (sessionId: string, blocks: CommandBlock[]) => void
  onBlockActivityChange: (sessionId: string, activity: BlockTrackerActivity) => void
  onAskBlocks: (blocks: CommandBlock[]) => void
  onRerunBlock: (block: CommandBlock) => void
  onSaveSnippet: (command: string) => void
  terminalTheme?: TerminalColors
}

export interface TerminalPaneHandle {
  focus: () => void
  blockOutputText: (block: CommandBlock) => string
  blockFullText: (block: CommandBlock) => string
}

const SEARCH_DECORATIONS = {
  matchBackground: '#29C4E826',
  matchOverviewRuler: '#29C4E8',
  activeMatchColorOverviewRuler: '#29C4E8'
}

const DEFAULT_TERMINAL_THEME: TerminalColors = {
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

// C1 control characters (U+0080–U+009F) that appear as ?<0080> artifacts
const C1_REGEX = /[-]/g

interface TerminalMetrics {
  top: number
  left: number
  width: number
  cellHeight: number
  cellWidth: number
  viewportY: number
  rows: number
}

interface Disposable {
  dispose: () => void
}

function sameTerminalMetrics(a: TerminalMetrics | null, b: TerminalMetrics): boolean {
  if (!a) return false

  return (
    a.top === b.top &&
    a.left === b.left &&
    a.width === b.width &&
    a.cellHeight === b.cellHeight &&
    a.cellWidth === b.cellWidth &&
    a.viewportY === b.viewportY &&
    a.rows === b.rows
  )
}


function parseCssRgb(value: string | undefined): [number, number, number] | undefined {
  const color = value?.trim()
  if (!color) return undefined

  const shortHex = /^#([0-9a-f]{3})$/i.exec(color)
  if (shortHex) {
    return shortHex[1].split('').map((part) => parseInt(`${part}${part}`, 16)) as [number, number, number]
  }

  const hex = /^#([0-9a-f]{6})$/i.exec(color)
  if (hex) {
    return [
      parseInt(hex[1].slice(0, 2), 16),
      parseInt(hex[1].slice(2, 4), 16),
      parseInt(hex[1].slice(4, 6), 16)
    ]
  }

  const rgb = /^rgba?\((\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?)/i.exec(color)
  if (rgb) {
    return [
      Math.round(Number(rgb[1])),
      Math.round(Number(rgb[2])),
      Math.round(Number(rgb[3]))
    ]
  }

  return undefined
}

function toHexChannel(value: number): string {
  return Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0')
}

function blendHex(background: [number, number, number], foreground: [number, number, number], alpha: number): string {
  const channels = background.map((channel, index) => channel + (foreground[index] - channel) * alpha)
  return `#${channels.map(toHexChannel).join('')}`
}

function terminalBlockDecorationColor(container: HTMLElement, alpha = 0.16): string {
  const styles = getComputedStyle(container)
  const rootStyles = getComputedStyle(document.documentElement)
  const background = parseCssRgb(styles.backgroundColor) ??
    parseCssRgb(styles.getPropertyValue('--bg-terminal')) ??
    [12, 12, 14]
  const accent = parseCssRgb(rootStyles.getPropertyValue('--accent-brand')) ?? [232, 57, 154]

  return blendHex(background, accent, alpha)
}


export const TerminalPane = forwardRef<TerminalPaneHandle, TerminalPaneProps>(function TerminalPane({
  activeSession,
  sessionIds,
  layoutKey,
  textSize,
  fontFamily,
  cursorStyle,
  cursorBlink,
  lineHeight,
  scrollback,
  clearSignal,
  onSelectionChange,
  outputBuffers,
  onOutput,
  onReconnect,
  commandBlocks,
  selectedBlockIds,
  onToggleBlockSelection,
  onClearBlockSelection,
  onBlocksChange,
  onBlockActivityChange,
  onAskBlocks,
  onRerunBlock,
  onSaveSnippet,
  terminalTheme
}: TerminalPaneProps, ref): JSX.Element {
  const { t } = useT()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const searchRef = useRef<SearchAddon | null>(null)
  const activeSessionIdRef = useRef<string>()
  const resizeFrameRef = useRef<number>()
  const metricsFrameRef = useRef<number>()
  const initialResizeTimerRef = useRef<number>()
  const textSizeRef = useRef(textSize)
  const fontFamilyRef = useRef(fontFamily)
  const cursorStyleRef = useRef(cursorStyle)
  const cursorBlinkRef = useRef(cursorBlink)
  const lineHeightRef = useRef(lineHeight)
  const scrollbackRef = useRef(scrollback)
  const activeSessionStatusRef = useRef(activeSession?.status)
  const renderedSessionKeyRef = useRef<string>()
  const restoringRef = useRef(false)
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null)
  const activeTrackerRef = useRef<BlockTracker | null>(null)
  const onBlocksChangeRef = useRef(onBlocksChange)
  const onBlockActivityChangeRef = useRef(onBlockActivityChange)
  const commandBlocksRef = useRef<CommandBlock[]>([])
  const selectedBlockIdsRef = useRef<string[]>([])
  const activeSessionNonceRef = useRef<string>()
  const blockHighlightFrameRef = useRef<number>()
  const blockHighlightDecorationsRef = useRef<Disposable[]>([])
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [searchResults, setSearchResults] = useState<{ index: number, count: number } | null>(null)
  const [terminalMetrics, setTerminalMetrics] = useState<TerminalMetrics | null>(null)
  const [hoveredBlockId, setHoveredBlockId] = useState<string>()
  const [isAlternateBufferActive, setIsAlternateBufferActive] = useState(false)
  const activeSessionId = activeSession?.id
  const activeSessionRenderStatus = getSessionRenderStatus(activeSession?.status)
  const areTerminalBlocksAvailable = !isAlternateBufferActive
  const selectedBlocks = useMemo(
    () => areTerminalBlocksAvailable
      ? commandBlocks.filter((block) => selectedBlockIds.includes(block.id))
      : [],
    [areTerminalBlocksAvailable, commandBlocks, selectedBlockIds]
  )

  const syncBlockHighlightDecorations = useCallback((): void => {
    const terminal = terminalRef.current
    const container = containerRef.current
    if (!terminal || !container) return

    for (const decoration of blockHighlightDecorationsRef.current) {
      decoration.dispose()
    }
    blockHighlightDecorationsRef.current = []
    if (terminal.buffer.active.type === 'alternate') return

    const tracker = activeTrackerRef.current
    const viewportY = terminal.buffer.active.viewportY
    const viewportEnd = viewportY + terminal.rows - 1
    const cursorLine = terminal.buffer.active.baseY + terminal.buffer.active.cursorY

    const registerRangeDecorations = (
      blockIds: Iterable<string>,
      target: MutableRefObject<Disposable[]>,
      backgroundColor: string,
      opacity: string
    ): void => {
      for (const blockId of blockIds) {
        const blocks = commandBlocksRef.current
        const block = blocks.find((b) => b.id === blockId)
        const range = tracker && block ? tracker.blockHighlightRange(block) : undefined
        if (!range || range.end < viewportY || range.start > viewportEnd) continue

        const visibleStart = Math.max(range.start, viewportY)
        const visibleEnd = Math.min(range.end, viewportEnd)
        for (let line = visibleStart; line <= visibleEnd; line += 1) {
          let marker: ReturnType<Terminal['registerMarker']> | undefined
          try {
            marker = terminal.registerMarker(line - cursorLine)
            if (!marker) {
              console.warn('[terminal block highlight decoration unavailable]', { line })
              continue
            }

            const decoration = terminal.registerDecoration({
              marker,
              x: 0,
              width: terminal.cols,
              height: 1,
              backgroundColor,
              layer: 'bottom'
            })
            if (!decoration) {
              marker.dispose()
              marker = undefined
              console.warn('[terminal block highlight decoration unavailable]', { line })
              continue
            }
            const renderDisposable = decoration.onRender((element) => {
              element.style.backgroundColor = backgroundColor
              element.style.opacity = opacity
              element.style.pointerEvents = 'none'
              element.style.transition = 'opacity 140ms ease, background-color 140ms ease'
              element.style.animation = 'terminalBlockDecorationIn 160ms ease-out both'
            })
            const activeMarker = marker
            target.current.push({
              dispose: () => {
                renderDisposable.dispose()
                decoration.dispose()
                activeMarker.dispose()
              }
            })
            marker = undefined
          } catch (error) {
            marker?.dispose()
            console.error('[terminal block highlight decoration failed]', error)
          }
        }
      }
    }

    const selectedIds = new Set(selectedBlockIdsRef.current)
    const selectedColor = terminalBlockDecorationColor(container, 0.12)
    registerRangeDecorations(selectedIds, blockHighlightDecorationsRef, selectedColor, '0.30')
  }, [])

  const scheduleBlockHighlightSync = useCallback((): void => {
    if (blockHighlightFrameRef.current) {
      cancelAnimationFrame(blockHighlightFrameRef.current)
    }
    blockHighlightFrameRef.current = requestAnimationFrame(() => {
      blockHighlightFrameRef.current = undefined
      syncBlockHighlightDecorations()
    })
  }, [syncBlockHighlightDecorations])

  const updateTerminalMetrics = useCallback((): void => {
    const terminal = terminalRef.current
    const container = containerRef.current
    if (!terminal || !container) {
      setTerminalMetrics(null)
      return
    }

    const screen = container.querySelector('.xterm-screen')
    if (!(screen instanceof HTMLElement) || terminal.rows <= 0) {
      setTerminalMetrics(null)
      return
    }

    const frameRect = container.getBoundingClientRect()
    const screenRect = screen.getBoundingClientRect()
    const cellHeight = screenRect.height / terminal.rows
    if (!Number.isFinite(cellHeight) || cellHeight <= 0) {
      setTerminalMetrics(null)
      return
    }

    const nextMetrics = {
      top: screenRect.top - frameRect.top,
      left: screenRect.left - frameRect.left,
      width: screenRect.width,
      cellHeight,
      cellWidth: screenRect.width / Math.max(terminal.cols, 1),
      viewportY: terminal.buffer.active.viewportY,
      rows: terminal.rows
    }
    setTerminalMetrics((current) => sameTerminalMetrics(current, nextMetrics) ? current : nextMetrics)
    scheduleBlockHighlightSync()
  }, [scheduleBlockHighlightSync])

  const scheduleTerminalMetricsUpdate = useCallback((): void => {
    if (metricsFrameRef.current) return
    metricsFrameRef.current = requestAnimationFrame(() => {
      metricsFrameRef.current = undefined
      updateTerminalMetrics()
    })
  }, [updateTerminalMetrics])

  useImperativeHandle(ref, () => ({
    focus: () => {
      terminalRef.current?.focus()
    },
    blockOutputText: (block: CommandBlock) => {
      return activeTrackerRef.current?.blockOutputText(block) ?? ''
    },
    blockFullText: (block: CommandBlock) => {
      return activeTrackerRef.current?.blockFullText(block) ?? ''
    }
  }), [])

  useEffect(() => {
    commandBlocksRef.current = commandBlocks
    selectedBlockIdsRef.current = selectedBlockIds
    scheduleBlockHighlightSync()
  }, [scheduleBlockHighlightSync, commandBlocks, selectedBlockIds])

  useEffect(() => {
    onBlocksChangeRef.current = onBlocksChange
  }, [onBlocksChange])

  useEffect(() => {
    onBlockActivityChangeRef.current = onBlockActivityChange
  }, [onBlockActivityChange])

  const closeSearch = useCallback((): void => {
    setIsSearchOpen(false)
    setSearchTerm('')
    setSearchResults(null)
    searchRef.current?.clearDecorations()
    terminalRef.current?.focus()
  }, [])

  const findNext = useCallback((): void => {
    if (!searchTerm.trim()) return
    searchRef.current?.findNext(searchTerm, { decorations: SEARCH_DECORATIONS })
  }, [searchTerm])

  const findPrevious = useCallback((): void => {
    if (!searchTerm.trim()) return
    searchRef.current?.findPrevious(searchTerm, { decorations: SEARCH_DECORATIONS })
  }, [searchTerm])

  useEffect(() => {
    const terminal = new Terminal({
      cursorBlink: cursorBlinkRef.current,
      cursorStyle: cursorStyleRef.current,
      cursorInactiveStyle: cursorStyleRef.current,
      fontFamily: fontFamilyRef.current,
      fontSize: textSizeRef.current,
      lineHeight: lineHeightRef.current,
      allowProposedApi: true,
      macOptionIsMeta: true,
      minimumContrastRatio: 4.5,
      scrollback: scrollbackRef.current,
      overviewRulerWidth: 0,
      theme: DEFAULT_TERMINAL_THEME
    })
    const fit = new FitAddon()
    const search = new SearchAddon()
    let webglAddon: WebglAddon | undefined
    let webglContextLossDisposable: Disposable | undefined
    const webLinks = new WebLinksAddon((_event, uri) => {
      void window.api.app.openExternalUrl(uri).catch((error: unknown) => {
        console.error('[terminal link open failed]', error)
      })
    })
    terminal.loadAddon(fit)
    terminal.loadAddon(search)
    terminal.loadAddon(webLinks)
    ;(terminal as XtermInternals)._taviraqFit = fit
    terminalRef.current = terminal
    fitRef.current = fit
    searchRef.current = search

    if (containerRef.current) {
      terminal.open(containerRef.current)
      if (!navigator.webdriver) {
        try {
          webglAddon = new WebglAddon()
          webglContextLossDisposable = webglAddon.onContextLoss(() => {
            console.warn('[terminal webgl context lost, falling back to canvas renderer]')
            webglAddon?.dispose()
            terminal.refresh(0, terminal.rows - 1)
          })
          terminal.loadAddon(webglAddon)
        } catch {
          // WebGL not available, falls back to canvas
        }
      }
      initialResizeTimerRef.current = window.setTimeout(() => {
        if (containerRef.current) {
          scheduleResize(terminal, containerRef.current, activeSessionIdRef.current, resizeFrameRef)
        }
      }, 150)
    }
    const viewport = containerRef.current?.querySelector('.xterm-viewport')
    const handleViewportScroll = (): void => {
      setHoveredBlockId(undefined)
      scheduleTerminalMetricsUpdate()
    }
    viewport?.addEventListener('scroll', handleViewportScroll, { passive: true })

    const dataDisposable = terminal.onData((data) => {
      if (restoringRef.current) return
      const sessionId = activeSessionIdRef.current
      if (sessionId && isLiveSessionStatus(activeSessionStatusRef.current)) {
        void window.api.terminal.write(sessionId, data)
      }
    })

    const selectionDisposable = terminal.onSelectionChange(() => {
      onSelectionChange(terminal.getSelection())
    })

    const resultsDisposable = search.onDidChangeResults(({ resultIndex, resultCount }) => {
      setSearchResults({ index: resultIndex, count: resultCount })
    })

    const scrollDisposable = terminal.onScroll(() => {
      setHoveredBlockId(undefined)
      scheduleTerminalMetricsUpdate()
    })
    const bufferDisposable = terminal.buffer.onBufferChange((buffer) => {
      const isAlternate = buffer.type === 'alternate'
      setIsAlternateBufferActive(isAlternate)
      setHoveredBlockId(undefined)
      if (isAlternate) {
        onClearBlockSelection()
      }
      scheduleTerminalMetricsUpdate()
      scheduleBlockHighlightSync()
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
        scheduleTerminalMetricsUpdate()
      }
    })
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current)
    }

    return () => {
      dataDisposable.dispose()
      selectionDisposable.dispose()
      resultsDisposable.dispose()
      scrollDisposable.dispose()
      bufferDisposable.dispose()
      viewport?.removeEventListener('scroll', handleViewportScroll)
      offTerminalData()
      resizeObserver.disconnect()
      if (initialResizeTimerRef.current) {
        window.clearTimeout(initialResizeTimerRef.current)
        initialResizeTimerRef.current = undefined
      }
      if (blockHighlightFrameRef.current) {
        cancelAnimationFrame(blockHighlightFrameRef.current)
        blockHighlightFrameRef.current = undefined
      }
      if (metricsFrameRef.current) {
        cancelAnimationFrame(metricsFrameRef.current)
        metricsFrameRef.current = undefined
      }
      for (const decoration of blockHighlightDecorationsRef.current) {
        decoration.dispose()
      }
      blockHighlightDecorationsRef.current = []
      activeTrackerRef.current?.dispose()
      activeTrackerRef.current = null
      cancelScheduledResize(resizeFrameRef)
      delete (terminal as XtermInternals)._taviraqFit
      webglContextLossDisposable?.dispose()
      terminal.dispose()
      fitRef.current = null
      searchRef.current = null
    }
  }, [onClearBlockSelection, onSelectionChange, onOutput, scheduleBlockHighlightSync, scheduleTerminalMetricsUpdate])

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        event.stopPropagation()
        setIsSearchOpen(true)
        window.setTimeout(() => {
          searchInputRef.current?.focus()
          searchInputRef.current?.select()
        }, 0)
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'g' && isSearchOpen) {
        event.preventDefault()
        event.stopPropagation()
        if (event.shiftKey) {
          findPrevious()
        } else {
          findNext()
        }
      } else if (event.key === 'Escape' && isSearchOpen) {
        event.preventDefault()
        event.stopPropagation()
        closeSearch()
      } else if (event.key === 'Escape' && selectedBlockIds.length) {
        event.preventDefault()
        event.stopPropagation()
        onClearBlockSelection()
      }
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => { window.removeEventListener('keydown', onKeyDown, true) }
  }, [closeSearch, findNext, findPrevious, isSearchOpen, onClearBlockSelection, selectedBlockIds.length])

  useEffect(() => {
    const search = searchRef.current
    if (!search || !isSearchOpen) return

    if (searchTerm.trim()) {
      search.findNext(searchTerm, { incremental: true, decorations: SEARCH_DECORATIONS })
    } else {
      search.clearDecorations()
      setSearchResults(null)
    }
  }, [isSearchOpen, searchTerm])

  useEffect(() => {
    const terminal = terminalRef.current
    if (terminal && terminalTheme) {
      terminal.options.theme = terminalTheme
      scheduleTerminalMetricsUpdate()
    }
  }, [scheduleTerminalMetricsUpdate, terminalTheme])

  useEffect(() => {
    const terminal = terminalRef.current
    textSizeRef.current = textSize
    if (!terminal) return

    terminal.options.fontSize = textSize
    if (containerRef.current) {
      scheduleResize(terminal, containerRef.current, activeSessionIdRef.current, resizeFrameRef)
      scheduleTerminalMetricsUpdate()
    }
  }, [scheduleTerminalMetricsUpdate, textSize])

  useEffect(() => {
    const terminal = terminalRef.current
    fontFamilyRef.current = fontFamily
    cursorStyleRef.current = cursorStyle
    cursorBlinkRef.current = cursorBlink
    lineHeightRef.current = lineHeight
    scrollbackRef.current = scrollback
    if (!terminal) return

    terminal.options.fontFamily = fontFamily
    terminal.options.cursorStyle = cursorStyle
    terminal.options.cursorInactiveStyle = cursorStyle
    terminal.options.cursorBlink = cursorBlink
    terminal.options.lineHeight = lineHeight
    terminal.options.scrollback = scrollback
    if (containerRef.current) {
      scheduleResize(terminal, containerRef.current, activeSessionIdRef.current, resizeFrameRef)
      scheduleTerminalMetricsUpdate()
    }
  }, [cursorBlink, cursorStyle, fontFamily, lineHeight, scheduleTerminalMetricsUpdate, scrollback])

  useEffect(() => {
    activeSessionIdRef.current = isLiveSessionStatus(activeSession?.status) ? activeSessionId : undefined
    activeSessionStatusRef.current = activeSession?.status
    activeSessionNonceRef.current = activeSession?.shellIntegrationNonce
  }, [activeSessionId, activeSession?.status, activeSession?.shellIntegrationNonce])

  const recreateBlockTracker = useCallback(() => {
    const terminal = terminalRef.current
    if (activeTrackerRef.current) {
      activeTrackerRef.current.dispose()
      activeTrackerRef.current = null
    }
    if (!terminal || !activeSessionId) return
    const nonce = activeSessionNonceRef.current ?? ''
    activeTrackerRef.current = new BlockTracker(
      terminal,
      activeSessionId,
      nonce,
      () => {
        const blocks = activeTrackerRef.current?.getBlocks() ?? []
        commandBlocksRef.current = blocks
        onBlocksChangeRef.current(activeSessionId, blocks)
        scheduleBlockHighlightSync()
      },
      (activity) => onBlockActivityChangeRef.current(activeSessionId, activity)
    )
  }, [activeSessionId, scheduleBlockHighlightSync])

  useEffect(() => {
    const terminal = terminalRef.current
    if (!terminal) return

    const sessionKey = `${activeSessionId ?? ''}:${activeSessionRenderStatus ?? ''}`
    if (renderedSessionKeyRef.current === sessionKey) {
      return
    }
    renderedSessionKeyRef.current = sessionKey

    terminal.reset()
    searchRef.current?.clearDecorations()
    setSearchResults(null)

    // Recreate BlockTracker for this session
    recreateBlockTracker()

    const output = activeSessionId ? outputBuffers.current.get(activeSessionId) ?? '' : ''
    if (activeSessionId && output) {
      restoringRef.current = true
      terminal.write(outputWithVisibleCursor(output), () => {
        setTimeout(() => { restoringRef.current = false }, 50)
        scheduleTerminalMetricsUpdate()
      })
    } else if (!activeSessionId) {
      terminal.write(`\r\n${t('terminal.noActiveSession')}\r\n`)
    }

    queueMicrotask(() => {
      if (containerRef.current) {
        scheduleResize(terminal, containerRef.current, activeSessionIdRef.current, resizeFrameRef)
        scheduleTerminalMetricsUpdate()
      }
      if (activeSessionIdRef.current && terminal.cols > 1 && terminal.rows > 1) {
        void window.api.terminal.resize(activeSessionIdRef.current, terminal.cols, terminal.rows)
      }
    })
  }, [activeSessionId, activeSessionRenderStatus, outputBuffers, recreateBlockTracker, scheduleTerminalMetricsUpdate, t])

  useEffect(() => {
    if (!activeSessionId) return
    // Don't steal focus while a modal dialog owns it. The active session can
    // change with a dialog still open — Settings > Connections connecting an SSH
    // profile, or a Cmd+1..9 tab switch while renaming a tab / confirming a
    // prompt — and the terminal sits behind the dialog, so focusing it would
    // misdirect the user's typing.
    const focused = document.activeElement
    if (focused instanceof HTMLElement && focused.closest('[role="dialog"], [role="alertdialog"]')) return
    // Move keyboard focus into the terminal when the active session changes so
    // switching tabs doesn't leave focus stuck on the tab button (which would
    // swallow keystrokes and beep on unhandled keys).
    terminalRef.current?.focus()
  }, [activeSessionId])

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
    // xterm disposes every registered marker on clear(), so the tracker's
    // pending block (if any) is left holding disposed markers — recreate it
    // rather than let the next block finalize as permanently unusable.
    recreateBlockTracker()
    onSelectionChange('')
    onClearBlockSelection()
  }, [clearSignal, onClearBlockSelection, onSelectionChange, recreateBlockTracker])

  useEffect(() => {
    const terminal = terminalRef.current
    if (terminal && containerRef.current) {
      scheduleResize(terminal, containerRef.current, activeSessionIdRef.current, resizeFrameRef)
      scheduleTerminalMetricsUpdate()
    }
  }, [layoutKey, scheduleTerminalMetricsUpdate])

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault()
      if (event.shiftKey) {
        findPrevious()
      } else {
        findNext()
      }
    } else if (event.key === 'Escape') {
      event.preventDefault()
      closeSearch()
    }
  }

  const blockAtClientY = useCallback((clientY: number): CommandBlock | undefined => {
    if (!areTerminalBlocksAvailable) return undefined
    const tracker = activeTrackerRef.current
    if (!tracker || !tracker.hasBlocks()) return undefined

    const terminal = terminalRef.current
    const container = containerRef.current
    if (!terminal || !container) return undefined

    const screen = container.querySelector('.xterm-screen')
    if (!(screen instanceof HTMLElement) || terminal.rows <= 0) return undefined

    const rect = screen.getBoundingClientRect()
    if (clientY < rect.top || clientY > rect.bottom) return undefined

    const cellHeight = rect.height / terminal.rows
    const line = terminal.buffer.active.viewportY + Math.floor((clientY - rect.top) / cellHeight)
    return tracker.blockAtRow(line)
  }, [areTerminalBlocksAvailable])

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    terminalRef.current?.focus()
    pointerStartRef.current = { x: event.clientX, y: event.clientY }
  }

  const handleFrameMouseMove = (event: MouseEvent<HTMLDivElement>): void => {
    if (event.buttons !== 0) return
    if ((event.target as Element | null)?.closest('.terminal-block-toolbar')) return

    const block = blockAtClientY(event.clientY)
    setHoveredBlockId((current) => current === block?.id ? current : block?.id)
  }

  const handleFrameMouseLeave = (): void => {
    setHoveredBlockId(undefined)
  }

  const handleClick = (event: MouseEvent<HTMLDivElement>): void => {
    if ((event.target as Element | null)?.closest('.terminal-block-toolbar')) return
    if ((event.target as Element | null)?.closest('.terminal-block-select-handle')) return

    const start = pointerStartRef.current
    pointerStartRef.current = null
    if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4) return

    const additive = event.metaKey || event.ctrlKey
    const block = blockAtClientY(event.clientY)
    if (block && additive) {
      event.preventDefault()
      onToggleBlockSelection(block.id, true)
    } else if (!additive && !block) {
      onClearBlockSelection()
    }
  }

  const selectBlockFromHandle = (event: MouseEvent<HTMLButtonElement>, blockId: string): void => {
    event.preventDefault()
    event.stopPropagation()
    onToggleBlockSelection(blockId, true)
  }

  const selectedBlockText = useCallback((block: CommandBlock): string => {
    return activeTrackerRef.current?.blockFullText(block) ?? block.command
  }, [])

  const copyText = useCallback((text: string): void => {
    void navigator.clipboard.writeText(text)
  }, [])

  const copySelectedBlocks = useCallback((): void => {
    copyText(selectedBlocks.map(selectedBlockText).join('\n\n'))
  }, [copyText, selectedBlockText, selectedBlocks])

  const copySelectedCommands = useCallback((): void => {
    if (!selectedBlocks.every(hasCommandText)) return
    copyText(selectedBlocks.map((block) => block.command).join('\n'))
  }, [copyText, selectedBlocks])

  const copySelectedOutputs = useCallback((): void => {
    copyText(selectedBlocks.map((block) => {
      return activeTrackerRef.current?.blockOutputText(block) ?? ''
    }).join('\n\n'))
  }, [copyText, selectedBlocks])

  const rerunSelectedBlock = useCallback((): void => {
    const block = selectedBlocks[0]
    if (!block || !hasCommandText(block) || selectedBlocks.length !== 1 || !isLiveSessionStatus(activeSession?.status)) return
    onRerunBlock(block)
  }, [activeSession?.status, onRerunBlock, selectedBlocks])

  const saveSelectedSnippet = useCallback((): void => {
    const block = selectedBlocks[0]
    if (!block || !hasCommandText(block) || selectedBlocks.length !== 1) return
    onSaveSnippet(block.command.trim())
  }, [onSaveSnippet, selectedBlocks])

  const selectedCommandsAvailable = selectedBlocks.every(hasCommandText)

  const visibleSelectedBlocks = terminalMetrics
    ? selectedBlocks
      .map((block) => {
        const tracker = activeTrackerRef.current
        const range = tracker ? tracker.blockHighlightRange(block) : undefined
        if (!range) return null

        const viewportY = terminalRef.current?.buffer.active.viewportY ?? terminalMetrics.viewportY
        const viewportEnd = viewportY + terminalMetrics.rows - 1
        if (range.end < viewportY || range.start > viewportEnd) {
          return null
        }

        const visibleStart = Math.max(range.start, viewportY)
        const visibleEnd = Math.min(range.end, viewportEnd)
        return {
          block,
          top: terminalMetrics.top + (visibleStart - viewportY) * terminalMetrics.cellHeight,
          height: Math.max(terminalMetrics.cellHeight, (visibleEnd - visibleStart + 1) * terminalMetrics.cellHeight)
        }
      })
      .filter((entry): entry is { block: CommandBlock; top: number; height: number } => Boolean(entry))
    : []
  const toolbarTop = terminalMetrics && visibleSelectedBlocks.length
    ? Math.min(
      terminalMetrics.top + terminalMetrics.rows * terminalMetrics.cellHeight - 38,
      Math.max(8, Math.max(...visibleSelectedBlocks.map((entry) => entry.top + entry.height)) + 6)
    )
    : 10
  const hoveredBlockHandle = areTerminalBlocksAvailable && terminalMetrics && hoveredBlockId
    ? (() => {
      const tracker = activeTrackerRef.current
      const hoveredBlock = commandBlocksRef.current.find((block) => block.id === hoveredBlockId)
      const range = tracker && hoveredBlock ? tracker.blockHighlightRange(hoveredBlock) : undefined
      if (!hoveredBlock || !range) return null

      const viewportY = terminalRef.current?.buffer.active.viewportY ?? terminalMetrics.viewportY
      const viewportEnd = viewportY + terminalMetrics.rows - 1
      if (range.end < viewportY || range.start > viewportEnd) return null

      const visibleEnd = Math.min(range.end, viewportEnd)
      return {
        block: hoveredBlock,
        top: terminalMetrics.top + (visibleEnd - viewportY + 1) * terminalMetrics.cellHeight - 3,
        selected: selectedBlockIds.includes(hoveredBlock.id)
      }
    })()
    : null

  return (
    <div
      className="terminal-frame"
      onMouseMove={handleFrameMouseMove}
      onMouseLeave={handleFrameMouseLeave}
    >
      <div
        className="terminal-container"
        ref={containerRef}
        onPointerDown={handlePointerDown}
        onClick={handleClick}
      />
      {hoveredBlockHandle ? (
        <button
          type="button"
          className={`terminal-block-select-handle${hoveredBlockHandle.selected ? ' selected' : ''}`}
          style={{ top: hoveredBlockHandle.top, right: 14 }}
          title={hoveredBlockHandle.selected ? t('terminal.blocks.deselect') : t('terminal.blocks.select')}
          aria-label={hoveredBlockHandle.selected ? t('terminal.blocks.deselect') : t('terminal.blocks.select')}
          onClick={(event) => selectBlockFromHandle(event, hoveredBlockHandle.block.id)}
        >
          {hoveredBlockHandle.selected
            ? <SquareCheckBig size={13} aria-hidden="true" />
            : <MousePointerClick size={13} aria-hidden="true" />}
          <span>{hoveredBlockHandle.selected ? t('terminal.blocks.deselect') : t('terminal.blocks.select')}</span>
        </button>
      ) : null}
      {selectedBlocks.length && visibleSelectedBlocks.length ? (
        <div className="terminal-block-toolbar" style={{ top: toolbarTop }}>
          <span className="terminal-block-count">{selectedBlocks.length}</span>
          {!selectedCommandsAvailable ? (
            <span className="terminal-block-command-unavailable">
              {t('terminal.blocks.commandUnavailable')}
            </span>
          ) : null}
          <button type="button" onClick={() => onAskBlocks(selectedBlocks)} title={t('terminal.blocks.askAi')} aria-label={t('terminal.blocks.askAi')}>
            <Sparkles size={14} aria-hidden="true" />
          </button>
          <button type="button" onClick={copySelectedBlocks} title={t('terminal.blocks.copyBlock')} aria-label={t('terminal.blocks.copyBlock')}>
            <Copy size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={copySelectedCommands}
            disabled={!selectedCommandsAvailable}
            title={selectedCommandsAvailable ? t('terminal.blocks.copyCommand') : t('terminal.blocks.commandUnavailable')}
            aria-label={selectedCommandsAvailable ? t('terminal.blocks.copyCommand') : t('terminal.blocks.commandUnavailable')}
          >
            <SquareTerminal size={14} aria-hidden="true" />
          </button>
          <button type="button" onClick={copySelectedOutputs} title={t('terminal.blocks.copyOutput')} aria-label={t('terminal.blocks.copyOutput')}>
            <FileText size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={rerunSelectedBlock}
            disabled={!selectedCommandsAvailable || selectedBlocks.length !== 1 || !isLiveSessionStatus(activeSession?.status)}
            title={selectedCommandsAvailable ? t('terminal.blocks.rerunCommand') : t('terminal.blocks.commandUnavailable')}
            aria-label={selectedCommandsAvailable ? t('terminal.blocks.rerunCommand') : t('terminal.blocks.commandUnavailable')}
          >
            <Play size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={saveSelectedSnippet}
            disabled={!selectedCommandsAvailable || selectedBlocks.length !== 1}
            title={selectedCommandsAvailable ? t('terminal.blocks.saveSnippet') : t('terminal.blocks.commandUnavailable')}
            aria-label={selectedCommandsAvailable ? t('terminal.blocks.saveSnippet') : t('terminal.blocks.commandUnavailable')}
          >
            <BookmarkPlus size={14} aria-hidden="true" />
          </button>
          <button type="button" onClick={onClearBlockSelection} title={t('terminal.blocks.clearSelection')} aria-label={t('terminal.blocks.clearSelection')}>
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      ) : null}
      {isSearchOpen ? (
        <div className={`terminal-search-panel${searchTerm.trim() && searchResults?.count === 0 ? ' no-results' : ''}`}>
          <Search size={14} aria-hidden="true" />
          <input
            ref={searchInputRef}
            value={searchTerm}
            onChange={(event) => { setSearchTerm(event.target.value) }}
            onKeyDown={handleSearchKeyDown}
            placeholder={t('terminal.searchPlaceholder')}
            aria-label={t('terminal.searchPlaceholder')}
          />
          <span className={`terminal-search-count${searchTerm.trim() && searchResults?.count === 0 ? ' no-results' : ''}`}>
            {searchTerm.trim() && searchResults
              ? searchResults.count > 0 && searchResults.index >= 0
                ? `${searchResults.index + 1}/${searchResults.count}`
                : t('terminal.searchNoResults')
              : ''}
          </span>
          <button
            type="button"
            className="terminal-search-button"
            onClick={findPrevious}
            disabled={!searchTerm.trim()}
            aria-label={t('terminal.searchPrevious')}
            title={t('terminal.searchPrevious')}
          >
            <ChevronUp size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="terminal-search-button"
            onClick={findNext}
            disabled={!searchTerm.trim()}
            aria-label={t('terminal.searchNext')}
            title={t('terminal.searchNext')}
          >
            <ChevronDown size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="terminal-search-button"
            onClick={closeSearch}
            aria-label={t('terminal.searchClose')}
            title={t('terminal.searchClose')}
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      ) : null}
      {activeSession?.status === 'disconnected' ? (
        <div className="terminal-reconnect-banner">
          <span>{t('terminal.sshDisconnected')}</span>
          <button
            type="button"
            className="quiet-button"
            onClick={() => onReconnect(activeSession.id)}
            disabled={!activeSession.reconnectCommand}
          >
            {t('terminal.reconnect')}
          </button>
        </div>
      ) : null}
    </div>
  )
})

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
  _taviraqFit?: FitAddon
}

function hasXtermRenderer(terminal: Terminal): boolean {
  return Boolean((terminal as XtermInternals)._core?._renderService?._renderer?.value)
}

function fitRefFor(terminal: Terminal): FitAddon | undefined {
  return (terminal as XtermInternals)._taviraqFit
}
