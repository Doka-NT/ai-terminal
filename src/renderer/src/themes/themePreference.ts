// SPDX-License-Identifier: MPL-2.0
import { DEFAULT_THEME_ID, themeMap } from './definitions'

const LEGACY_TAVIRAQ_DARK_THEME_ID = 'ai-terminal-dark'
const TAVIRAQ_DARK_THEME_ID = 'taviraq-dark'

export function migrateLegacyThemeId(themeId: string): string {
  return themeId === LEGACY_TAVIRAQ_DARK_THEME_ID
    ? TAVIRAQ_DARK_THEME_ID
    : themeId
}

export function resolveThemeId(themeId: string | null | undefined): string {
  if (!themeId) return DEFAULT_THEME_ID

  const migratedThemeId = migrateLegacyThemeId(themeId)
  return Object.hasOwn(themeMap, migratedThemeId)
    ? migratedThemeId
    : DEFAULT_THEME_ID
}
