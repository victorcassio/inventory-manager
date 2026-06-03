import { beforeEach, describe, expect, it } from 'vitest'
import { useThemeStore, resolveTheme, applyTheme } from '@/stores/theme.store'

beforeEach(() => {
  localStorage.clear()
  document.documentElement.classList.remove('dark')
  useThemeStore.setState({ theme: 'system' })
})

describe('resolveTheme', () => {
  it('returns the explicit value for light/dark', () => {
    expect(resolveTheme('light')).toBe('light')
    expect(resolveTheme('dark')).toBe('dark')
  })

  it('resolves "system" via matchMedia (light by default mock)', () => {
    expect(resolveTheme('system')).toBe('light')
  })
})

describe('applyTheme', () => {
  it('adds the dark class when resolved theme is dark', () => {
    applyTheme('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('removes the dark class when resolved theme is light', () => {
    document.documentElement.classList.add('dark')
    applyTheme('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })
})

describe('useThemeStore', () => {
  it('setTheme updates state and the dark class', () => {
    useThemeStore.getState().setTheme('dark')
    expect(useThemeStore.getState().theme).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('toggleTheme flips from resolved light to explicit dark', () => {
    useThemeStore.setState({ theme: 'system' }) // resolves to light
    useThemeStore.getState().toggleTheme()
    expect(useThemeStore.getState().theme).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('toggleTheme flips from dark back to light', () => {
    useThemeStore.setState({ theme: 'dark' })
    useThemeStore.getState().toggleTheme()
    expect(useThemeStore.getState().theme).toBe('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('persists the theme to localStorage', () => {
    useThemeStore.getState().setTheme('dark')
    expect(localStorage.getItem('inventory-theme')).toContain('"theme":"dark"')
  })
})
