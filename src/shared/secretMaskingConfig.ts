// SPDX-License-Identifier: MPL-2.0
import type { SecretMaskingSettings } from './types'

export const SECRET_MASKING_AUDIT_LIMIT = 80
export const CUSTOM_SECRET_PATTERN_MAX_LENGTH = 180
export const CUSTOM_SECRET_SCAN_MAX_TEXT_LENGTH = 20_000
export const CUSTOM_SECRET_PATTERN_MAX_MATCHES = 40
export const BARE_SECRET_MAX_MATCHES = 40

export function createDefaultSecretMaskingSettings(): SecretMaskingSettings {
  return {
    mode: 'on',
    applyToChatDisplay: true,
    applyToProviderPayloads: true,
    strictTerminalContext: false,
    customPatterns: []
  }
}

export function isStrictTerminalContextActive(settings: SecretMaskingSettings): boolean {
  return settings.mode === 'on' && settings.strictTerminalContext
}

export function isSafeCustomSecretPatternSource(source: string): boolean {
  if (!source || source.length > CUSTOM_SECRET_PATTERN_MAX_LENGTH) return false

  const withoutEscapes = source.replace(/\\./g, '')
  if (/\\[1-9]/.test(source)) return false
  if (/\(\?(?:[=!]|<[=!])/.test(withoutEscapes)) return false

  const quantifiedGroupWithQuantifier =
    /\((?:[^()[\]\\]|\\.|\[[^\]]*\])*(?:[+*]|\{\d*,?\d*\})(?:[^()[\]\\]|\\.|\[[^\]]*\])*\)(?:[+*]|\{\d*,?\d*\})/
  if (quantifiedGroupWithQuantifier.test(withoutEscapes)) return false

  const repeatedGroupWithAlternation =
    /\((?:[^()[\]\\]|\\.|\[[^\]]*\])*\|(?:[^()[\]\\]|\\.|\[[^\]]*\])*\)(?:[+*]|\{\d*,?\d*\})/
  if (repeatedGroupWithAlternation.test(withoutEscapes)) return false

  const repeatedNestedGroup = /\([^)]*\([^)]*\)[^)]*\)(?:[+*]|\{\d*,?\d*\})/
  if (repeatedNestedGroup.test(withoutEscapes)) return false

  return true
}
