export type ThemePreference = 'light' | 'dark' | 'system'
export type EffectiveTheme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'tgsaas.theme'

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system'
}

export function normalizeThemePreference(value: unknown): ThemePreference {
  return isThemePreference(value) ? value : 'system'
}

export function getEffectiveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): EffectiveTheme {
  if (preference === 'system') {
    return systemPrefersDark ? 'dark' : 'light'
  }

  return preference
}

export function resolveThemeState(
  storedPreference: unknown,
  systemPrefersDark: boolean,
): {
  preference: ThemePreference
  effectiveTheme: EffectiveTheme
} {
  const preference = normalizeThemePreference(storedPreference)

  return {
    preference,
    effectiveTheme: getEffectiveTheme(preference, systemPrefersDark),
  }
}

export function getSystemPrefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function readStoredThemePreference(): ThemePreference {
  if (typeof window === 'undefined') {
    return 'system'
  }

  try {
    return normalizeThemePreference(window.localStorage.getItem(THEME_STORAGE_KEY))
  } catch {
    return 'system'
  }
}

export function writeStoredThemePreference(preference: ThemePreference): void {
  if (typeof window === 'undefined') {
    return
  }

  try {
    if (preference === 'system') {
      window.localStorage.removeItem(THEME_STORAGE_KEY)
      return
    }

    window.localStorage.setItem(THEME_STORAGE_KEY, preference)
  } catch {
    // Ignore storage failures so theming still works for the session.
  }
}

export function applyThemeClass(root: Element, theme: EffectiveTheme): void {
  root.classList.toggle('dark', theme === 'dark')
  root.setAttribute('data-theme', theme)
}

export function shouldSyncThemeStorageEvent(eventKey: string | null): boolean {
  return eventKey === THEME_STORAGE_KEY || eventKey === null
}
