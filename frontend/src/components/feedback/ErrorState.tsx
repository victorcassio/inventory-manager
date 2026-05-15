import { AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface ErrorStateProps {
  message?: string
  onRetry?: () => void
}

export function ErrorState({ message = 'Ocorreu um erro ao carregar os dados.', onRetry }: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <AlertCircle className="mb-4 h-12 w-12 text-destructive" />
      <h3 className="text-lg font-semibold">Erro</h3>
      <p className="mt-2 text-sm text-muted-foreground">{message}</p>
      {onRetry && (
        <Button className="mt-4" variant="outline" onClick={onRetry}>
          Tentar novamente
        </Button>
      )}
    </div>
  )
}
