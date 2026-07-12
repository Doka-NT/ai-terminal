// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest'
import { DEFAULT_THEME_ID, themes } from '@renderer/themes/definitions'
import { migrateLegacyThemeId, resolveThemeId } from '@renderer/themes/themePreference'

describe('theme preference', () => {
  it('uses Horizon as the product default', () => {
    expect(DEFAULT_THEME_ID).toBe('horizon')
    expect(resolveThemeId(null)).toBe('horizon')
    expect(resolveThemeId(undefined)).toBe('horizon')
    expect(resolveThemeId('')).toBe('horizon')
  })

  it('preserves every valid current theme id', () => {
    for (const theme of themes) {
      expect(resolveThemeId(theme.id)).toBe(theme.id)
    }
    expect(resolveThemeId('taviraq-dark')).toBe('taviraq-dark')
  })

  it('migrates the legacy dark alias without following the new default', () => {
    expect(migrateLegacyThemeId('ai-terminal-dark')).toBe('taviraq-dark')
    expect(resolveThemeId('ai-terminal-dark')).toBe('taviraq-dark')
  })

  it('falls back to Horizon for unknown and prototype-like ids', () => {
    expect(resolveThemeId('missing-theme')).toBe('horizon')
    expect(resolveThemeId('__proto__')).toBe('horizon')
    expect(resolveThemeId('toString')).toBe('horizon')
  })

  it('leaves a valid imported theme unchanged', () => {
    expect(resolveThemeId('dracula')).toBe('dracula')
  })
})
