import { createContext, useContext, type ReactNode } from 'react'
import { TRANSLATIONS } from './translations'
import type { Language, Translations } from './translations'

interface LanguageContextValue {
  language: Language
  t: (key: keyof Translations, vars?: Record<string, string | number>) => string
}

const defaultT = (key: keyof Translations, vars?: Record<string, string | number>): string => {
  let result = TRANSLATIONS.en[key]
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      result = result.replace(`{${k}}`, String(v))
    }
  }
  return result
}

export const LanguageContext = createContext<LanguageContextValue>({
  language: 'en',
  t: defaultT
})

export function useT(): LanguageContextValue {
  return useContext(LanguageContext)
}

interface LanguageProviderProps {
  language: Language
  children: ReactNode
}

export function LanguageProvider({ language, children }: LanguageProviderProps): JSX.Element {
  const translations = TRANSLATIONS[language]

  const t = (key: keyof Translations, vars?: Record<string, string | number>): string => {
    let result = translations[key]
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        result = result.replace(`{${k}}`, String(v))
      }
    }
    return result
  }

  return (
    <LanguageContext.Provider value={{ language, t }}>
      {children}
    </LanguageContext.Provider>
  )
}
