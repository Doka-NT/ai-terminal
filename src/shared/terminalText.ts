// SPDX-License-Identifier: MPL-2.0

const ANSI_ESCAPE = String.fromCharCode(27)
// Lazy `*?`: a greedy star here would match from the first OSC introducer through the
// LAST terminator in the string, deleting real text between two separate OSC sequences.
const OSC_RE = new RegExp(`${ANSI_ESCAPE}\\][^\\u0007]*?(?:\\u0007|${ANSI_ESCAPE}\\\\)`, 'g')
const CSI_RE = new RegExp(
  `${ANSI_ESCAPE}\\[[0-9;?]*[ -/]*[@-~]|${ANSI_ESCAPE}[@-_]|\\r(?!\\n)|[\\u0080-\\u009f]`,
  'g'
)

// Strips full OSC sequences (title, hyperlinks, and shell-integration markers like
// OSC 133/633, terminated by BEL or ST) before CSI/C1 sequences. A CSI-only stripper
// leaves the OSC 633;E command text and shell-integration nonce as visible plain text.
export function stripAnsi(value: string): string {
  return value.replace(OSC_RE, '').replace(CSI_RE, '')
}

// Strips OSC sequences from the FULL raw buffer before bounding it to maxChars. Slicing
// a raw buffer first can bisect an OSC 633;E marker, leaving a headless `633;E;...;<nonce>`
// tail that no longer starts with the escape prefix stripAnsi requires to match it, so the
// nonce would reach the request payload as plain text.
export function boundTerminalOutputForRequest(rawOutput: string, maxChars: number): string | undefined {
  const bounded = stripAnsi(rawOutput).slice(-maxChars)
  return bounded || undefined
}

const OSC_INTRODUCER = `${ANSI_ESCAPE}]`
const OSC_ST = `${ANSI_ESCAPE}\\`
// Command text is at most a few KB in practice; this bounds how far back we'll
// look for an OSC introducer before giving up and accepting the naive cut.
const OSC_TRIM_LOOKBACK = 8192

// Bounds a raw terminal output buffer to at most maxChars WITHOUT stripping OSC
// content — unlike boundTerminalOutputForRequest, this is for buffers that must
// keep intact OSC bytes for other consumers (e.g. session-restore block
// reconstruction reads OSC 633;E markers back out of outputBuffers). Instead it
// moves the cut point earlier when the naive tail would start mid-sequence, so
// a headless `633;E;...;<nonce>` fragment never gets stored.
export function trimTerminalOutputBuffer(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value
  const targetCutAt = value.length - maxChars
  const introducerIndex = value.lastIndexOf(OSC_INTRODUCER, targetCutAt - 1)
  if (introducerIndex === -1 || introducerIndex < targetCutAt - OSC_TRIM_LOOKBACK) {
    return value.slice(targetCutAt)
  }
  const belIndex = value.indexOf('\x07', introducerIndex)
  const stIndex = value.indexOf(OSC_ST, introducerIndex)
  const useBel = belIndex !== -1 && (stIndex === -1 || belIndex <= stIndex)
  const terminatorEnd = useBel ? belIndex + 1 : stIndex === -1 ? -1 : stIndex + OSC_ST.length
  // Safe only if the WHOLE terminator (both bytes for ST) ends at or before
  // the cut — otherwise the sequence spans the cut, so cut before it instead.
  if (terminatorEnd !== -1 && terminatorEnd <= targetCutAt) {
    return value.slice(targetCutAt)
  }
  return value.slice(introducerIndex)
}

// Decodes the shell-integration escaping scheme used for OSC 633;E command text:
// \ -> \\, ; -> \x3b, \n -> \x0a, \r -> \x0d (in that encode order). Decoding must walk
// the string left to right and resolve each backslash as it's found, rather than running
// four independent global replaces — otherwise a literal backslash immediately followed by
// a delimiter-escape-looking sequence (e.g. a command containing the literal text `\x3b`)
// is misread as an escape and decodes to the wrong character.
export function decodeShellIntegrationCommand(escaped: string): string {
  let result = ''
  let i = 0
  while (i < escaped.length) {
    if (escaped[i] === '\\') {
      if (escaped[i + 1] === '\\') {
        result += '\\'
        i += 2
        continue
      }
      const marker = escaped.slice(i, i + 4)
      if (marker === '\\x3b') {
        result += ';'
        i += 4
        continue
      }
      if (marker === '\\x0a') {
        result += '\n'
        i += 4
        continue
      }
      if (marker === '\\x0d') {
        result += '\r'
        i += 4
        continue
      }
    }
    result += escaped[i]
    i += 1
  }
  return result
}
