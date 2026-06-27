import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  THEME_STORAGE_KEY,
  applyThemeClass,
  getEffectiveTheme,
  isThemePreference,
  normalizeThemePreference,
  readStoredThemePreference,
  resolveThemeState,
  shouldSyncThemeStorageEvent,
  writeStoredThemePreference,
} from './theme'

type FakeClassList = {
  contains: (token: string) => boolean
  toggle: (token: string, force?: boolean) => boolean
}

type FakeRoot = {
  classList: FakeClassList
  setAttribute: (name: string, value: string) => void
  getAttribute: (name: string) => string | undefined
}

function createFakeRoot(): FakeRoot {
  const classes = new Set<string>()
  const attributes = new Map<string, string>()

  return {
    classList: {
      contains: (token) => classes.has(token),
      toggle: (token, force) => {
        if (force === undefined) {
          if (classes.has(token)) {
            classes.delete(token)
            return false
          }

          classes.add(token)
          return true
        }

        if (force) {
          classes.add(token)
          return true
        }

        classes.delete(token)
        return false
      },
    },
    setAttribute: (name, value) => {
      attributes.set(name, value)
    },
    getAttribute: (name) => attributes.get(name),
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('isThemePreference', () => {
  it('accepts only light, dark, and system', () => {
    expect(isThemePreference('light')).toBe(true)
    expect(isThemePreference('dark')).toBe(true)
    expect(isThemePreference('system')).toBe(true)

    expect(isThemePreference('')).toBe(false)
    expect(isThemePreference('Light')).toBe(false)
    expect(isThemePreference('auto')).toBe(false)
    expect(isThemePreference(null)).toBe(false)
    expect(isThemePreference(undefined)).toBe(false)
    expect(isThemePreference({})).toBe(false)
  })
})

describe('normalizeThemePreference', () => {
  it('falls back to system for invalid or null values', () => {
    expect(normalizeThemePreference('light')).toBe('light')
    expect(normalizeThemePreference('dark')).toBe('dark')
    expect(normalizeThemePreference('system')).toBe('system')

    expect(normalizeThemePreference('auto')).toBe('system')
    expect(normalizeThemePreference(null)).toBe('system')
    expect(normalizeThemePreference(undefined)).toBe('system')
  })
})

describe('getEffectiveTheme', () => {
  it('returns the explicit preference when set to light or dark', () => {
    expect(getEffectiveTheme('light', true)).toBe('light')
    expect(getEffectiveTheme('dark', false)).toBe('dark')
  })

  it('resolves system preference from the current system theme', () => {
    expect(getEffectiveTheme('system', true)).toBe('dark')
    expect(getEffectiveTheme('system', false)).toBe('light')
  })
})

describe('readStoredThemePreference', () => {
  it('reads a valid stored theme preference', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => key === THEME_STORAGE_KEY ? 'dark' : null,
      },
    })

    expect(readStoredThemePreference()).toBe('dark')
  })

  it('falls back to system when storage is unavailable or invalid', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => {
          throw new Error('storage blocked')
        },
      },
    })
    expect(readStoredThemePreference()).toBe('system')

    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => 'auto',
      },
    })
    expect(readStoredThemePreference()).toBe('system')
  })
})

describe('writeStoredThemePreference', () => {
  it('writes explicit theme preferences to storage', () => {
    const writes: Array<[string, string]> = []
    const removals: string[] = []

    vi.stubGlobal('window', {
      localStorage: {
        setItem: (key: string, value: string) => {
          writes.push([key, value])
        },
        removeItem: (key: string) => {
          removals.push(key)
        },
      },
    })

    writeStoredThemePreference('light')
    writeStoredThemePreference('dark')

    expect(writes).toEqual([
      [THEME_STORAGE_KEY, 'light'],
      [THEME_STORAGE_KEY, 'dark'],
    ])
    expect(removals).toEqual([])
  })

  it('removes the storage key for the system preference', () => {
    const writes: Array<[string, string]> = []
    const removals: string[] = []

    vi.stubGlobal('window', {
      localStorage: {
        setItem: (key: string, value: string) => {
          writes.push([key, value])
        },
        removeItem: (key: string) => {
          removals.push(key)
        },
      },
    })

    writeStoredThemePreference('system')

    expect(writes).toEqual([])
    expect(removals).toEqual([THEME_STORAGE_KEY])
  })

  it('swallows storage write failures', () => {
    vi.stubGlobal('window', {
      localStorage: {
        setItem: () => {
          throw new Error('quota exceeded')
        },
        removeItem: () => {
          throw new Error('quota exceeded')
        },
      },
    })

    expect(() => writeStoredThemePreference('dark')).not.toThrow()
    expect(() => writeStoredThemePreference('system')).not.toThrow()
  })
})

describe('applyThemeClass', () => {
  it('toggles the dark class and data-theme attribute', () => {
    const root = createFakeRoot()

    applyThemeClass(root as unknown as Element, 'dark')
    expect(root.classList.contains('dark')).toBe(true)
    expect(root.getAttribute('data-theme')).toBe('dark')

    applyThemeClass(root as unknown as Element, 'light')
    expect(root.classList.contains('dark')).toBe(false)
    expect(root.getAttribute('data-theme')).toBe('light')
  })
})

describe('resolveThemeState', () => {
  it('resolves the bootstrap theme state from storage and system preference', () => {
    expect(resolveThemeState('system', true)).toEqual({
      preference: 'system',
      effectiveTheme: 'dark',
    })
    expect(resolveThemeState('dark', false)).toEqual({
      preference: 'dark',
      effectiveTheme: 'dark',
    })
  })

  it('falls back to system when the stored preference is invalid', () => {
    expect(resolveThemeState('auto', false)).toEqual({
      preference: 'system',
      effectiveTheme: 'light',
    })
  })
})

describe('shouldSyncThemeStorageEvent', () => {
  it('syncs for theme-key updates and clear events', () => {
    expect(shouldSyncThemeStorageEvent(THEME_STORAGE_KEY)).toBe(true)
    expect(shouldSyncThemeStorageEvent(null)).toBe(true)
  })

  it('ignores unrelated storage keys', () => {
    expect(shouldSyncThemeStorageEvent('tg_saas_session')).toBe(false)
  })
})
