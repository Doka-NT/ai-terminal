// SPDX-License-Identifier: MPL-2.0
// Isolated fallback block detector for sessions that produce zero OSC 133/633
// marks (unknown shells, SSH without shell integration, plain sh, recovery
// shells). Emits CommandBlock-compatible objects with quality:'heuristic'.
// This is the ONLY place heuristic prompt/command detection should live.

import type { Terminal } from '@xterm/xterm'
import type { CommandBlock } from './blockTracker'
import { commandLineCandidates, commandStartLineCandidates, commandVisibleLineCount } from './terminalBlocks'

const PROMPT_GLYPHS = '>$#%❯➜'

export function isPromptOnlyLine(text: string): boolean {
  const trimmed = text.trim()
  return trimmed === '~' || trimmed === '%' || trimmed === '>' || /^[➜$#❯>]\s*$/.test(trimmed)
}

function candidateMatchesAtLineEnd(line: string, candidate: string): boolean {
  const value = line.trimEnd()
  if (!value.endsWith(candidate)) return false
  const before = value[value.length - candidate.length - 1]
  return before === undefined || before.trim() === '' || PROMPT_GLYPHS.includes(before)
}

function lineMatchesCommandCandidate(line: string, command: string): boolean {
  return commandLineCandidates(command).some((c) => candidateMatchesAtLineEnd(line, c))
}

function lineMatchesCommandStartCandidate(line: string, command: string): boolean {
  return commandStartLineCandidates(command).some((c) => candidateMatchesAtLineEnd(line, c))
}

function findCommandLine(
  terminal: Terminal,
  command: string,
  searchFrom: number,
  searchTo: number
): number | undefined {
  for (let line = searchFrom; line <= searchTo; line++) {
    const text = terminal.buffer.active.getLine(line)?.translateToString(true) ?? ''
    if (lineMatchesCommandStartCandidate(text, command) || lineMatchesCommandCandidate(text, command)) {
      return line
    }
  }
  return undefined
}

export interface HeuristicBlockInfo {
  commandLine: number
  end: number
}

export function resolveHeuristicRanges(
  terminal: Terminal,
  blocks: CommandBlock[]
): Map<string, HeuristicBlockInfo> {
  const result = new Map<string, HeuristicBlockInfo>()
  const bufLen = terminal.buffer.active.length
  let searchFrom = 0

  const sorted = blocks.slice().sort((a, b) => {
    const aLine = a.promptStart.isDisposed ? 0 : a.promptStart.line
    const bLine = b.promptStart.isDisposed ? 0 : b.promptStart.line
    return aLine - bLine
  })

  for (let i = 0; i < sorted.length; i++) {
    const block = sorted[i]
    const command = block.command.trim()
    if (!command || block.promptStart.isDisposed) continue

    const promptLine = block.promptStart.line
    const cmdCount = Math.max(1, commandVisibleLineCount(command))
    const nearbyStart = Math.max(searchFrom, promptLine - cmdCount - 2)
    const nearbyEnd = Math.min(bufLen - 1, promptLine + 4)

    const commandLine = findCommandLine(terminal, command, nearbyStart, nearbyEnd)
      ?? findCommandLine(terminal, command, searchFrom, bufLen - 1)

    if (commandLine === undefined) continue

    // Find end: next block's command line or next prompt-only line
    const nextBlockLine = sorted.slice(i + 1)
      .map((b) => !b.promptStart.isDisposed ? b.promptStart.line : undefined)
      .find((l): l is number => l !== undefined && l > commandLine)

    let endLine = nextBlockLine !== undefined ? nextBlockLine - 1 : bufLen - 1

    // Walk backward over trailing prompt-only / empty lines
    while (endLine > commandLine) {
      const text = terminal.buffer.active.getLine(endLine)?.translateToString(true) ?? ''
      if (text.trim() !== '' && !isPromptOnlyLine(text)) break
      endLine--
    }

    result.set(block.id, { commandLine, end: endLine })
    searchFrom = commandLine + 1
  }

  return result
}
