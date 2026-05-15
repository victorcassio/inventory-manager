import { ClipboardList, AlertTriangle, Users, Package } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface StatCardProps {
  title: string
  value: number
  icon: React.ComponentType<{ className?: string }>
  description?: string
}

function StatCard({ title, value, icon: Icon, description }: StatCardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </CardContent>
    </Card>
  )
}

export function DashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Dashboard</h2>
        <p className="text-muted-foreground">Visão geral do sistema</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Locações Ativas"
          value={0}
          icon={ClipboardList}
          description="Em breve"
        />
        <StatCard
          title="Locações Vencidas"
          value={0}
          icon={AlertTriangle}
          description="Em breve"
        />
        <StatCard
          title="Clientes Ativos"
          value={0}
          icon={Users}
          description="Em breve"
        />
        <StatCard
          title="Estoque Disponível"
          value={0}
          icon={Package}
          description="Em breve"
        />
      </div>

      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          <p>Estatísticas detalhadas em breve.</p>
        </CardContent>
      </Card>
    </div>
  )
}
