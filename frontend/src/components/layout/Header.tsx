import { Menu } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAuthStore } from '@/stores/auth.store'

interface HeaderProps {
  title?: string
  onMenuClick?: () => void
}

export function Header({ title = 'Dashboard', onMenuClick }: HeaderProps) {
  const { user } = useAuthStore()

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
      {user && (
        <span className="text-sm text-muted-foreground">
          Olá, {user.name}
        </span>
      )}
    </header>
  )
}
