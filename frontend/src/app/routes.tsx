import { lazy } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { ProtectedRoute } from '@/components/layout/ProtectedRoute'
import { AppLayout } from '@/components/layout/AppLayout'
import { AuthLayout } from '@/components/layout/AuthLayout'

// ─── Eager (pequenas/sempre necessárias) ──────────────────────────────────────
import { LoginPage }     from '@/pages/LoginPage'
import { NotFoundPage }  from '@/pages/NotFoundPage'
import { ForbiddenPage } from '@/pages/ForbiddenPage'

// ─── Lazy (feature pages — carregadas sob demanda) ───────────────────────────
const DashboardPage = lazy(() =>
  import('@/pages/DashboardPage').then((m) => ({ default: m.DashboardPage }))
)
const CustomersListPage = lazy(() =>
  import('@/features/customers/pages/CustomersListPage').then((m) => ({ default: m.CustomersListPage }))
)
const CustomerNewPage = lazy(() =>
  import('@/features/customers/pages/CustomerNewPage').then((m) => ({ default: m.CustomerNewPage }))
)
const CustomerDetailPage = lazy(() =>
  import('@/features/customers/pages/CustomerDetailPage').then((m) => ({ default: m.CustomerDetailPage }))
)
const CustomerEditPage = lazy(() =>
  import('@/features/customers/pages/CustomerEditPage').then((m) => ({ default: m.CustomerEditPage }))
)
const ItemsListPage = lazy(() =>
  import('@/features/inventory/pages/ItemsListPage').then((m) => ({ default: m.ItemsListPage }))
)
const ItemNewPage = lazy(() =>
  import('@/features/inventory/pages/ItemNewPage').then((m) => ({ default: m.ItemNewPage }))
)
const ItemDetailPage = lazy(() =>
  import('@/features/inventory/pages/ItemDetailPage').then((m) => ({ default: m.ItemDetailPage }))
)
const CategoriesPage = lazy(() =>
  import('@/features/inventory/pages/CategoriesPage').then((m) => ({ default: m.CategoriesPage }))
)
const RentalsListPage = lazy(() =>
  import('@/features/rentals/pages/RentalsListPage').then((m) => ({ default: m.RentalsListPage }))
)
const RentalNewPage = lazy(() =>
  import('@/features/rentals/pages/RentalNewPage').then((m) => ({ default: m.RentalNewPage }))
)
const RentalDetailPage = lazy(() =>
  import('@/features/rentals/pages/RentalDetailPage').then((m) => ({ default: m.RentalDetailPage }))
)
const CreateReturnPage = lazy(() =>
  import('@/features/returns/pages/CreateReturnPage').then((m) => ({ default: m.CreateReturnPage }))
)
const CreatePaymentPage = lazy(() =>
  import('@/features/payments/pages/CreatePaymentPage').then((m) => ({ default: m.CreatePaymentPage }))
)
const PaymentsListPage = lazy(() =>
  import('@/features/payments/pages/PaymentsListPage').then((m) => ({ default: m.PaymentsListPage }))
)
const FinancialListPage = lazy(() =>
  import('@/features/financial/pages/FinancialListPage').then((m) => ({ default: m.FinancialListPage }))
)
const FinancialNewPage = lazy(() =>
  import('@/features/financial/pages/FinancialNewPage').then((m) => ({ default: m.FinancialNewPage }))
)
const FinancialDetailPage = lazy(() =>
  import('@/features/financial/pages/FinancialDetailPage').then((m) => ({ default: m.FinancialDetailPage }))
)
const FinancialEditPage = lazy(() =>
  import('@/features/financial/pages/FinancialEditPage').then((m) => ({ default: m.FinancialEditPage }))
)
const DocumentsListPage = lazy(() =>
  import('@/features/documents/pages/DocumentsListPage').then((m) => ({ default: m.DocumentsListPage }))
)
const CalendarPage = lazy(() =>
  import('@/features/calendar/pages/CalendarPage').then((m) => ({ default: m.CalendarPage }))
)

export function AppRoutes() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public routes */}
        <Route element={<AuthLayout />}>
          <Route path="/login" element={<LoginPage />} />
        </Route>

        {/* Protected routes */}
        <Route element={<ProtectedRoute />}>
          <Route element={<AppLayout />}>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/403" element={<ForbiddenPage />} />
            <Route path="/customers" element={<CustomersListPage />} />
            <Route path="/customers/new" element={<CustomerNewPage />} />
            <Route path="/customers/:id" element={<CustomerDetailPage />} />
            <Route path="/customers/:id/edit" element={<CustomerEditPage />} />
            <Route path="/inventory/items" element={<ItemsListPage />} />
            <Route path="/inventory/items/new" element={<ItemNewPage />} />
            <Route path="/inventory/items/:id" element={<ItemDetailPage />} />
            <Route path="/inventory/categories" element={<CategoriesPage />} />
            <Route path="/rentals" element={<RentalsListPage />} />
            <Route path="/rentals/new" element={<RentalNewPage />} />
            <Route path="/rentals/:id" element={<RentalDetailPage />} />
            <Route path="/rentals/:id/returns/new" element={<CreateReturnPage />} />
            <Route path="/rentals/:id/payments/new" element={<CreatePaymentPage />} />
            <Route path="/payments" element={<PaymentsListPage />} />
            <Route path="/calendar" element={<CalendarPage />} />
            <Route path="/documents" element={<DocumentsListPage />} />
            <Route path="/financial" element={<Navigate to="/financial/transactions" replace />} />
            <Route path="/financial/transactions" element={<FinancialListPage />} />
            <Route path="/financial/transactions/new" element={<FinancialNewPage />} />
            <Route path="/financial/transactions/:id" element={<FinancialDetailPage />} />
            <Route path="/financial/transactions/:id/edit" element={<FinancialEditPage />} />
          </Route>
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  )
}
