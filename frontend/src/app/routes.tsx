import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { ProtectedRoute } from '@/components/layout/ProtectedRoute'
import { AppLayout } from '@/components/layout/AppLayout'
import { AuthLayout } from '@/components/layout/AuthLayout'
import { LoginPage } from '@/pages/LoginPage'
import { DashboardPage } from '@/pages/DashboardPage'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { ForbiddenPage } from '@/pages/ForbiddenPage'
import { CustomersListPage } from '@/features/customers/pages/CustomersListPage'
import { CustomerNewPage } from '@/features/customers/pages/CustomerNewPage'
import { CustomerDetailPage } from '@/features/customers/pages/CustomerDetailPage'
import { CustomerEditPage } from '@/features/customers/pages/CustomerEditPage'
import { ItemsListPage } from '@/features/inventory/pages/ItemsListPage'
import { ItemNewPage } from '@/features/inventory/pages/ItemNewPage'
import { ItemDetailPage } from '@/features/inventory/pages/ItemDetailPage'
import { CategoriesPage } from '@/features/inventory/pages/CategoriesPage'
import { RentalsListPage } from '@/features/rentals/pages/RentalsListPage'
import { RentalNewPage } from '@/features/rentals/pages/RentalNewPage'
import { RentalDetailPage } from '@/features/rentals/pages/RentalDetailPage'
import { CreateReturnPage } from '@/features/returns/pages/CreateReturnPage'
import { CreatePaymentPage } from '@/features/payments/pages/CreatePaymentPage'

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
          </Route>
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  )
}
