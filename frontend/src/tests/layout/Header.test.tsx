import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Header } from '@/components/layout/Header'
import { useAuthStore } from '@/stores/auth.store'
import { useThemeStore } from '@/stores/theme.store'

vi.mock('@/stores/auth.store', () => ({ useAuthStore: vi.fn() }))
const mockUseAuthStore = useAuthStore as unknown as ReturnType<typeof vi.fn>

beforeEach(() => {
  mockUseAuthStore.mockReturnValue({ user: null })
  useThemeStore.setState({ theme: 'system' }) // resolves to light via mock
  document.documentElement.classList.remove('dark')
})

describe('Header theme toggle', () => {
  it('renders the toggle with an accessible "switch to dark mode" label in light mode', () => {
    render(<Header />)
    expect(
      screen.getByRole('button', { name: /switch to dark mode/i }),
    ).toBeInTheDocument()
  })

  it('switches to dark mode and updates the label/icon on click', async () => {
    const user = userEvent.setup()
    render(<Header />)
    await user.click(screen.getByRole('button', { name: /switch to dark mode/i }))
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(
      screen.getByRole('button', { name: /switch to light mode/i }),
    ).toBeInTheDocument()
  })
})
