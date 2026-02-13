import { en } from './en'
import { nl } from './nl'

export type SupportedLang = 'en' | 'nl'

const DICTS = {
  en,
  nl,
} as const

export type I18nKey = keyof typeof en

export function mapLocaleToLang(locale: string | null | undefined): SupportedLang {
  const l = (locale ?? '').toLowerCase()
  return l.startsWith('nl') ? 'nl' : 'en'
}

export function createT(lang: SupportedLang) {
  const dict = DICTS[lang] ?? DICTS.en

  return function t(key: I18nKey): string {
    return (dict as any)[key] ?? (DICTS.en as any)[key] ?? key
  }
}
