import { Menu, Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAuthStore } from '@/stores/auth.store'
import { useThemeStore, resolveTheme } from '@/stores/theme.store'

interface HeaderProps {
  title?: string
  onMenuClick?: () => void
}

export function Header({ title = 'Dashboard', onMenuClick }: HeaderProps) {
  const { user } = useAuthStore()
  const theme = useThemeStore((s) => s.theme)
  const toggleTheme = useThemeStore((s) => s.toggleTheme)
  const isDark = resolveTheme(theme) === 'dark'
  const label = isDark ? 'Switch to light mode' : 'Switch to dark mode'

  return (
    <header className="flex h-16 items-center border-b bg-background px-6">
      <Button
        variant="ghost"
        size="icon"
        className="mr-4"
        onClick={onMenuClick}
      >
        <Menu className="h-5 w-5" />
        <span className="sr-only">Menu</span>
      </Button>
      <h2 className="flex-1 text-xl font-semibold">{title}</h2>
      <Button
        variant="ghost"
        size="icon"
        onClick={toggleTheme}
        aria-label={label}
        title={label}
      >
        {isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        <span className="sr-only">{label}</span>
      </Button>
      {user && (
        <span className="ml-4 text-sm text-muted-foreground">
          Olá, {user.name}
        </span>
      )}
    </header>
  )
}
