import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Plus, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { useCategories, useCreateCategory } from '../hooks/useInventory'
import { categorySchema, type CategoryFormValues } from '@/schemas/inventory.schema'
import { useAuthStore } from '@/stores/auth.store'

export function CategoriesPage() {
  const { user } = useAuthStore()
  const [showForm, setShowForm] = useState(false)
  const { data: categories, isLoading, isError, refetch } = useCategories()
  const createCategory = useCreateCategory()

  const canManage = user?.role === 'admin'

  const form = useForm<CategoryFormValues>({
    resolver: zodResolver(categorySchema),
    defaultValues: { name: '', description: '' },
  })

  const onSubmit = async (values: CategoryFormValues) => {
    await createCategory.mutateAsync(values)
    form.reset()
    setShowForm(false)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Categorias</h2>
        {canManage && !showForm && (
          <Button onClick={() => setShowForm(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Nova Categoria
          </Button>
        )}
      </div>

      {/* New category form */}
      {showForm && canManage && (
        <Card className="max-w-lg">
          <CardHeader>
            <CardTitle>Nova Categoria</CardTitle>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Nome *</FormLabel>
                      <FormControl>
                        <Input placeholder="Nome da categoria" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Descrição</FormLabel>
                      <FormControl>
                        <Input placeholder="Descrição opcional" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="flex gap-3">
                  <Button type="submit" disabled={createCategory.isPending}>
                    {createCategory.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Salvar
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
                    Cancelar
                  </Button>
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>
      )}

      {/* Categories list */}
      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      )}

      {isError && <ErrorState onRetry={() => refetch()} />}

      {!isLoading && !isError && categories && (
        categories.length === 0 ? (
          <EmptyState
            title="Nenhuma categoria cadastrada"
            description="Crie a primeira categoria para organizar o inventário."
          />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {categories.map((cat) => (
              <Card key={cat.id}>
                <CardContent className="flex items-center justify-between py-4">
                  <div>
                    <p className="font-medium">{cat.name}</p>
                    {cat.description && (
                      <p className="text-sm text-muted-foreground">{cat.description}</p>
                    )}
                  </div>
                  <Badge variant={cat.isActive ? 'default' : 'secondary'}>
                    {cat.isActive ? 'Ativa' : 'Inativa'}
                  </Badge>
                </CardContent>
              </Card>
            ))}
          </div>
        )
      )}
    </div>
  )
}
