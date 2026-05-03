/**
 * Mapping from KeyboardEvent.code (physical key) to Electron Accelerator key name.
 * @see https://www.electronjs.org/docs/latest/api/accelerator
 */

const codeToAccelKey: Record<string, string> = {
  // Alphanumeric
  KeyA: 'A', KeyB: 'B', KeyC: 'C', KeyD: 'D', KeyE: 'E',
  KeyF: 'F', KeyG: 'G', KeyH: 'H', KeyI: 'I', KeyJ: 'J',
  KeyK: 'K', KeyL: 'L', KeyM: 'M', KeyN: 'N', KeyO: 'O',
  KeyP: 'P', KeyQ: 'Q', KeyR: 'R', KeyS: 'S', KeyT: 'T',
  KeyU: 'U', KeyV: 'V', KeyW: 'W', KeyX: 'X', KeyY: 'Y',
  KeyZ: 'Z',

  // Digits
  Digit0: '0', Digit1: '1', Digit2: '2', Digit3: '3', Digit4: '4',
  Digit5: '5', Digit6: '6', Digit7: '7', Digit8: '8', Digit9: '9',

  // Special characters
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  IntlBackslash: '\\',

  // Whitespace & editing
  Space: 'Space',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Enter: 'Enter',
  Return: 'Return',

  // Navigation
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  Home: 'Home', End: 'End',
  PageUp: 'PageUp', PageDown: 'PageDown',

  // Escape
  Escape: 'Escape',

  // Function keys
  F1: 'F1', F2: 'F2', F3: 'F3', F4: 'F4', F5: 'F5',
  F6: 'F6', F7: 'F7', F8: 'F8', F9: 'F9', F10: 'F10',
  F11: 'F11', F12: 'F12', F13: 'F13', F14: 'F14', F15: 'F15',
  F16: 'F16', F17: 'F17', F18: 'F18', F19: 'F19', F20: 'F20',
  F21: 'F21', F22: 'F22', F23: 'F23', F24: 'F24',

  // Numpad
  Numpad0: 'num0', Numpad1: 'num1', Numpad2: 'num2', Numpad3: 'num3', Numpad4: 'num4',
  Numpad5: 'num5', Numpad6: 'num6', Numpad7: 'num7', Numpad8: 'num8', Numpad9: 'num9',
  NumpadDecimal: 'numdec', NumpadAdd: 'numadd', NumpadSubtract: 'numsub',
  NumpadMultiply: 'nummult', NumpadDivide: 'numdiv', NumpadEnter: 'Enter',

  // Lock keys
  CapsLock: 'Capslock', NumLock: 'Numlock', ScrollLock: 'Scrolllock'
}

/** Set of code values that represent modifier keys (not real key presses). */
const modifierCodes = new Set([
  'MetaLeft', 'MetaRight',
  'ControlLeft', 'ControlRight',
  'ShiftLeft', 'ShiftRight',
  'AltLeft', 'AltRight',
  'OSLeft', 'OSRight'
])

/**
 * Convert a physical key code to Electron Accelerator key name.
 * Returns `undefined` if the code is not recognized (modifier or unknown key).
 */
export function codeToAccelerator(code: string): string | undefined {
  if (modifierCodes.has(code)) return undefined
  return codeToAccelKey[code]
}

/**
 * Build an Electron Accelerator string from modifier flags and a key code.
 * Returns `null` if no modifier is held or the key is a modifier.
 *
 * @param meta - Cmd (macOS) / Win (other)
 * @param ctrl - Ctrl key
 * @param shift - Shift key
 * @param alt - Alt / Option
 * @param code - Physical key code from KeyboardEvent.code or Input.code
 */
export function buildAccelerator(meta: boolean, ctrl: boolean, shift: boolean, alt: boolean, code: string): string | null {
  const parts: string[] = []
  if (meta) parts.push('CommandOrControl')
  else if (ctrl) parts.push('Ctrl')
  if (shift) parts.push('Shift')
  if (alt) parts.push('Alt')

  const accelKey = codeToAccelerator(code)
  if (!accelKey) return null

  if (!parts.length) return null
  parts.push(accelKey)
  return parts.join('+')
}

/**
 * Convert Electron Accelerator string to a human-readable display form.
 * Example: "CommandOrControl+Shift+`" → "⌘⇧`"
 */
export function acceleratorToDisplay(shortcut: string): string {
  return shortcut
    .replace('CommandOrControl', '⌘')
    .replace('Command', '⌘')
    .replace('Ctrl', '⌃')
    .replace('Control', '⌃')
    .replace('Shift', '⇧')
    .replace('Alt', '⌥')
    .replace('Option', '⌥')
    .replace(/\+/g, '')
}
