import { Play, TerminalSquare } from 'lucide-react'
import { buildActionChips, detectMiniBarRows } from '@renderer/utils/redesign'

interface MessageContentProps {
  content: string
  onRun?: (command: string) => void | Promise<void>
  onPrompt?: (prompt: string) => void
  disabled?: boolean
}

type Segment =
  | { type: 'text'; text: string }
  | { type: 'code'; code: string; lang: string }

type TextBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'table'; header: string[]; rows: string[][] }

const FENCE_RE = /```([a-z]*)\n([\s\S]*?)```/g
const SHELL_LANGS = new Set(['bash', 'sh', 'shell', 'zsh', 'cmd', 'fish', 'ksh'])

function parseContent(content: string): Segment[] {
  const segments: Segment[] = []
  let lastIndex = 0

  for (const match of content.matchAll(FENCE_RE)) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', text: content.slice(lastIndex, match.index) })
    }
    segments.push({ type: 'code', lang: match[1], code: match[2].trim() })
    lastIndex = match.index + match[0].length
  }

  if (lastIndex < content.length) {
    segments.push({ type: 'text', text: content.slice(lastIndex) })
  }

  return segments
}

function parseTextBlocks(text: string): TextBlock[] {
  const blocks: TextBlock[] = []
  const paragraphLines: string[] = []
  const lines = text.split('\n')

  const flushParagraph = (): void => {
    const paragraph = paragraphLines.join('\n').trim()
    if (paragraph) {
      blocks.push({ type: 'paragraph', text: paragraph })
    }
    paragraphLines.length = 0
  }

  for (let index = 0; index < lines.length; index += 1) {
    const header = parseTableRow(lines[index])
    const separator = parseTableRow(lines[index + 1] ?? '')

    if (header && separator && isTableSeparator(separator) && header.length === separator.length) {
      const rows: string[][] = []
      index += 2

      while (index < lines.length) {
        const row = parseTableRow(lines[index])
        if (!row || row.length !== header.length) break
        rows.push(row)
        index += 1
      }

      flushParagraph()
      blocks.push({ type: 'table', header, rows })
      index -= 1
      continue
    }

    if (!lines[index].trim()) {
      flushParagraph()
      continue
    }

    paragraphLines.push(lines[index])
  }

  flushParagraph()
  return blocks
}

function parseTableRow(line: string): string[] | undefined {
  const trimmed = line.trim()
  if (!trimmed.includes('|')) return undefined

  const cells = trimmed
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())

  return cells.length > 1 ? cells : undefined
}

function isTableSeparator(cells: string[]): boolean {
  return cells.every((cell) => /^:?-{3,}:?$/.test(cell))
}

function renderInline(text: string): (string | JSX.Element)[] {
  const parts: (string | JSX.Element)[] = []
  const re = /(`[^`]+`|\*\*[^*]+\*\*)/g
  let last = 0
  for (const m of text.matchAll(re)) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    const token = m[0]
    if (token.startsWith('`')) {
      parts.push(<code key={m.index} className="inline-code">{token.slice(1, -1)}</code>)
    } else {
      parts.push(<strong key={m.index}>{token.slice(2, -2)}</strong>)
    }
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

export function MessageContent({ content, onRun, onPrompt, disabled }: MessageContentProps): JSX.Element {
  const segments = parseContent(content)
  const actionChips = onPrompt ? buildActionChips(content) : []

  return (
    <div className="message-content">
      {segments.map((seg, i) => {
        if (seg.type === 'code') {
          const isShell = SHELL_LANGS.has(seg.lang) || seg.lang === ''
          return (
            <div className={`msg-action-pill${isShell ? '' : ' msg-action-pill--code'}`} key={i}>
              {isShell ? <TerminalSquare size={12} aria-hidden /> : (
                <span className="msg-code-lang">{seg.lang || 'code'}</span>
              )}
              <code>{seg.code}</code>
              {isShell && onRun ? (
                <button
                  className="msg-run-button"
                  type="button"
                  disabled={disabled}
                  onClick={() => { void onRun(seg.code) }}
                  title="Run in terminal"
                  aria-label="Run in terminal"
                >
                  <Play size={11} aria-hidden />
                </button>
              ) : null}
            </div>
          )
        }

        return parseTextBlocks(seg.text).map((block, j) => {
          if (block.type === 'table') {
            const miniBars = detectMiniBarRows(block.header, block.rows)

            return (
              <div className="message-table-group" key={`${i}-${j}`}>
                <div className="message-table-wrap">
                  <table className="message-table">
                    <thead>
                      <tr>
                        {block.header.map((cell, cellIndex) => (
                          <th key={cellIndex}>{renderInline(cell)}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {block.rows.map((row, rowIndex) => (
                        <tr key={rowIndex}>
                          {row.map((cell, cellIndex) => (
                            <td key={cellIndex}>{renderInline(cell)}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {miniBars.length > 0 ? (
                  <div className="mini-bars" aria-label="Visual summary">
                    {miniBars.map((bar) => (
                      <div className="mini-bar-row" key={`${bar.label}-${bar.displayValue}`}>
                        <div className="mini-bar-labels">
                          <span>{bar.label}</span>
                          <strong>{bar.displayValue}</strong>
                        </div>
                        <div className="mini-bar-track">
                          <span style={{ width: `${Math.max(4, Math.round(bar.ratio * 100))}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            )
          }

          return <p key={`${i}-${j}`}>{renderInline(block.text)}</p>
        })
      })}
      {actionChips.length > 0 ? (
        <div className="message-action-chips">
          {actionChips.map((chip) => (
            <button type="button" key={chip.label} onClick={() => onPrompt?.(chip.prompt)}>
              {chip.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
