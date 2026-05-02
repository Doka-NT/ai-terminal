import type { AssistMode } from '@shared/types'

export interface ModelLabel {
  name: string
  version: string
}

export interface SuggestionChip {
  id: string
  label: string
  prompt: string
}

export interface MiniBarRow {
  label: string
  value: number
  displayValue: string
  ratio: number
}

export interface ActionChip {
  label: string
  prompt: string
}

export interface InlineStatus {
  tone: 'info' | 'success' | 'warning' | 'danger'
  label: string
}

interface SuggestionContext {
  terminalOutput?: string
  cwd?: string
  selectedText?: string
  assistMode?: AssistMode
}

const KNOWN_MODEL_LABELS: Record<string, ModelLabel> = {
  'x-ai/grok-4.1-fast': { name: 'Grok', version: '4.1 fast' },
  'x-ai/grok-4': { name: 'Grok', version: '4' },
  'anthropic/claude-opus-4-6': { name: 'Claude', version: 'Opus 4.6' },
  'openai/gpt-4o': { name: 'GPT-4o', version: '' }
}

const SIZE_UNITS: Record<string, number> = {
  b: 1,
  byte: 1,
  bytes: 1,
  k: 1024,
  kb: 1024,
  kib: 1024,
  m: 1024 ** 2,
  mb: 1024 ** 2,
  mib: 1024 ** 2,
  g: 1024 ** 3,
  gb: 1024 ** 3,
  gib: 1024 ** 3,
  t: 1024 ** 4,
  tb: 1024 ** 4,
  tib: 1024 ** 4
}

export function formatModelLabel(modelId: string | undefined): ModelLabel {
  const trimmed = modelId?.trim()
  if (!trimmed) {
    return { name: 'Assistant', version: 'Choose a model' }
  }

  const known = KNOWN_MODEL_LABELS[trimmed]
  if (known) return known

  const slug = trimmed.split('/').at(-1) ?? trimmed
  const normalized = slug.replace(/[_-]+/g, ' ')

  if (/^grok[\s-]/i.test(slug)) {
    return { name: 'Grok', version: tidyVersion(slug.replace(/^grok[-_\s]*/i, '')) }
  }

  if (/^claude[\s-]/i.test(slug)) {
    return { name: 'Claude', version: titleCase(normalized.replace(/^claude\s*/i, '')) }
  }

  if (/^gpt[-_\s]?4o/i.test(slug)) {
    return { name: 'GPT-4o', version: tidyVersion(slug.replace(/^gpt[-_\s]?4o[-_\s]*/i, '')) }
  }

  if (/^gpt/i.test(slug)) {
    return { name: titleCase(normalized).replace(/^Gpt\b/, 'GPT'), version: '' }
  }

  if (/^o\d/i.test(slug)) {
    return { name: slug.split('-')[0].toUpperCase(), version: tidyVersion(slug.split('-').slice(1).join('-')) }
  }

  return { name: titleCase(normalized), version: '' }
}

export function buildSuggestionChips(context: SuggestionContext, limit = 3): SuggestionChip[] {
  const output = `${context.terminalOutput ?? ''}\n${context.cwd ?? ''}`.toLowerCase()
  const selectedText = context.selectedText?.trim()
  const suggestions: SuggestionChip[] = []

  const add = (id: string, label: string, prompt: string): void => {
    if (!suggestions.some((suggestion) => suggestion.id === id)) {
      suggestions.push({ id, label, prompt })
    }
  }

  if (selectedText) {
    add('selection', 'Explain selected text', 'Explain the selected terminal output.')
  }

  if (/\b(git status|\.git|on branch|changes not staged|nothing to commit)\b/.test(output)) {
    add('git', 'Show uncommitted changes', 'Show me the uncommitted changes in this project.')
  }

  if (/\b(dockerfile|docker-compose|compose\.ya?ml|docker system|container|image|volume)\b/.test(output)) {
    add('docker', 'Clean up Docker safely', 'Find safe Docker cleanup opportunities.')
  }

  if (/\.(log|out|err)\b|\/logs?\b/.test(output)) {
    add('logs', 'Find largest logs', 'Find the largest log files and suggest safe cleanup.')
  }

  if (/\b(\d+(?:\.\d+)?\s?[kmgt]b|\d+(?:\.\d+)?[kmgt]\b|du\s+-|disk|volume)\b/i.test(output)) {
    add('disk', 'Summarize disk usage', 'Summarize what is taking the most disk space.')
  }

  add('space', "What's taking space?", "What's taking the most disk space here?")
  add('processes', 'Check running processes', 'Check the most important running processes.')
  add('lastCommand', 'Explain last command', 'Explain the last terminal command and its output.')

  return suggestions.slice(0, limit)
}

export function detectMiniBarRows(header: string[], rows: string[][], limit = 5): MiniBarRow[] {
  const cleanHeader = header.map(cleanCell)
  const labelIndex = findLabelIndex(cleanHeader)
  const valueIndex = findValueIndex(cleanHeader, rows)

  if (labelIndex === -1 || valueIndex === -1 || labelIndex === valueIndex) return []

  const candidates = rows
    .map((row) => {
      const label = cleanCell(row[labelIndex] ?? '')
      const valueCell = cleanCell(row[valueIndex] ?? '')
      const value = parseCellValue(valueCell)

      if (!label || value === undefined || value <= 0) return undefined

      return {
        label,
        value,
        displayValue: valueCell,
        ratio: 0
      }
    })
    .filter((row): row is Omit<MiniBarRow, 'ratio'> & { ratio: number } => Boolean(row))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit)

  if (candidates.length < 2) return []

  const max = candidates[0]?.value ?? 1
  return candidates.map((row) => ({
    ...row,
    ratio: max > 0 ? row.value / max : 0
  }))
}

export function buildActionChips(content: string): ActionChip[] {
  const text = content.toLowerCase()

  if (/\bdocker\b/.test(text) && /\b(prune|cleanup|clean up|unused)\b/.test(text)) {
    return [
      { label: 'Plan cleanup', prompt: 'Create a safe Docker cleanup plan before running anything.' },
      { label: 'Show details', prompt: 'Show the detailed Docker resources behind this recommendation.' }
    ]
  }

  if (/\b(\d+(?:\.\d+)?\s?(gb|mb|tb)|disk|space|largest)\b/.test(text)) {
    return [
      { label: 'Show full list', prompt: 'Show the full disk usage list.' },
      { label: 'Find safe cleanup', prompt: 'Find safe cleanup options from these results.' }
    ]
  }

  if (/\b(error|failed|permission denied|not found)\b/.test(text)) {
    return [
      { label: 'Suggest fix', prompt: 'Suggest the safest fix for this error.' }
    ]
  }

  return []
}

export function statusToInlineStatus(status: string): InlineStatus {
  const text = status.trim()
  const lower = text.toLowerCase()

  if (/\b(failed|error|unavailable|could not|denied)\b/.test(lower)) {
    return { tone: 'danger', label: text }
  }

  if (/\b(risky|risk|safety|checking|confirmed)\b/.test(lower)) {
    return { tone: 'warning', label: text }
  }

  if (/\b(saved|loaded|ready)\b/.test(lower)) {
    return { tone: 'success', label: text }
  }

  return { tone: 'info', label: text }
}

function findLabelIndex(header: string[]): number {
  const preferred = header.findIndex((cell) => /\b(resource|name|path|directory|item|file)\b/i.test(cell))
  if (preferred !== -1) return preferred

  return header.findIndex((cell) => !parseCellValue(cell))
}

function findValueIndex(header: string[], rows: string[][]): number {
  let bestIndex = -1
  let bestScore = 0
  const width = Math.max(header.length, ...rows.map((row) => row.length))

  for (let index = 0; index < width; index += 1) {
    const headerBonus = /\b(size|total|used|reclaimable|usage|value)\b/i.test(header[index] ?? '') ? 0.5 : 0
    const score = rows.reduce((total, row) => {
      const value = cleanCell(row[index] ?? '')
      const parsed = parseCellValue(value)
      const sizeBonus = /\b(bytes?|[kmgt]i?b|[kmgt])\b/i.test(value) ? 3 : 1
      return parsed === undefined ? total : total + sizeBonus
    }, headerBonus)

    if (score > bestScore) {
      bestIndex = index
      bestScore = score
    }
  }

  return bestScore > 0 ? bestIndex : -1
}

function parseCellValue(cell: string): number | undefined {
  const normalized = cleanCell(cell).replace(/,/g, '')
  const match = normalized.match(/[~≈]?\s*(\d+(?:\.\d+)?)\s*([kmgt]i?b|bytes?|[kmgt]b?|b)?\b/i)
  if (!match) return undefined

  const amount = Number(match[1])
  if (!Number.isFinite(amount)) return undefined

  const unit = match[2]?.toLowerCase()
  if (!unit) return amount

  return amount * (SIZE_UNITS[unit] ?? 1)
}

function cleanCell(cell: string): string {
  return cell
    .replace(/[`*_~]/g, '')
    .replace(/<[^>]+>/g, '')
    .trim()
}

function tidyVersion(value: string): string {
  return value.replace(/[_-]+/g, ' ').trim()
}

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => {
      if (/^\d/.test(part)) return part
      return `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`
    })
    .join(' ')
}
