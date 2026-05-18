export type UserRole = 'admin' | 'attendant' | 'financial';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  lastLogin?: string | null;
  createdAt: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface Customer {
  id: string;
  name: string;
  document: string;
  documentType: 'cpf' | 'cnpj';
  phone?: string | null;
  email?: string | null;
  address?: CustomerAddress | null;
  notes?: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerAddress {
  street: string;
  number: string;
  complement?: string;
  district: string;
  city: string;
  state: string;
  zipCode: string;
}

export interface ItemCategory {
  id: string;
  name: string;
  description?: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Item {
  id: string;
  categoryId: string;
  category?: ItemCategory;
  name: string;
  description?: string | null;
  code: string;
  dailyRate: string;
  totalQty: number;
  availableQty: number;
  rentedQty: number;
  maintenanceQty: number;
  condition: 'new' | 'good' | 'fair' | 'maintenance';
  notes?: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export type RentalStatus = 'active' | 'returned' | 'canceled';
export type ComputedRentalStatus = 'active' | 'overdue' | 'returned' | 'canceled';

export interface RentalItem {
  id: string;
  rentalId: string;
  itemId: string;
  item?: Pick<Item, 'id' | 'name' | 'code' | 'dailyRate'>;
  quantity: number;
  unitPrice: string;
  returnedQty: number;
}

export interface Rental {
  id: string;
  customerId: string;
  customer?: Pick<Customer, 'id' | 'name' | 'document'>;
  userId: string;
  contractNumber: string;
  status: RentalStatus;
  computedStatus: ComputedRentalStatus;
  daysOverdue: number;
  startedAt: string;
  expectedReturn: string;
  returnedAt?: string | null;
  pricingType: 'daily' | 'fixed' | 'custom';
  deposit: string;
  discount: string;
  lateFee: string;
  extraCosts: string;
  subtotal?: string | null;
  total?: string | null;
  paidAmount: string;
  balanceAmount?: number;
  notes?: string | null;
  rentalItems?: RentalItem[];
  createdAt: string;
  updatedAt: string;
}

export interface Payment {
  id: string;
  rentalId: string;
  userId: string;
  amount: string;
  method: 'cash' | 'pix' | 'card' | 'transfer';
  paidAt: string;
  referenceCode?: string | null;
  notes?: string | null;
  createdAt: string;
  rental?: {
    id: string;
    contractNumber: string;
    customer?: { id: string; name: string } | null;
  } | null;
  user?: { id: string; name: string } | null;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

export type ReturnItemCondition = 'good' | 'damaged' | 'lost'

export interface ReturnItem {
  id: string
  returnId: string
  rentalItemId: string
  quantity: number
  condition: ReturnItemCondition
  damageFee: string
  notes?: string | null
  rentalItem?: {
    id: string
    quantity: number
    returnedQty: number
    unitPrice: string
    item?: Pick<Item, 'id' | 'name' | 'code'>
  }
}

export interface Return {
  id: string
  rentalId: string
  userId: string
  returnedAt: string
  isPartial: boolean
  lateDays: number
  lateFee: string
  notes?: string | null
  createdAt: string
  returnItems?: ReturnItem[]
  rental?: Rental
}

export type DocumentType = 'contract' | 'receipt' | 'return_proof'
export type DocumentStatus = 'generated' | 'voided'

export interface Document {
  id: string
  type: DocumentType
  filename: string
  path: string
  status: DocumentStatus
  rentalId?: string | null
  customerId?: string | null
  paymentId?: string | null
  returnId?: string | null
  userId?: string | null
  createdAt: string
  rental?: { id: string; contractNumber: string; customer: { id: string; name: string } } | null
}

export type FinancialTransactionType = 'income' | 'expense'
export type FinancialTransactionCategory =
  | 'rental_income'
  | 'stock_investment'
  | 'maintenance'
  | 'transport'
  | 'fixed_cost'
  | 'other'
export type FinancialTransactionOrigin = 'manual' | 'payment' | 'adjustment'

export interface FinancialTransaction {
  id: string
  userId: string
  rentalId?: string | null
  paymentId?: string | null
  type: FinancialTransactionType
  category: FinancialTransactionCategory
  origin: FinancialTransactionOrigin
  amount: string
  description: string
  date: string
  isVoided: boolean
  voidedAt?: string | null
  voidedById?: string | null
  voidReason?: string | null
  createdAt: string
  updatedAt: string
  user?: Pick<User, 'id' | 'name' | 'email'>
  rental?: { id: string; contractNumber: string } | null
  payment?: { id: string; amount: string; method: string; paidAt: string } | null
}

export interface FinancialSummary {
  totalIncome: number
  totalExpense: number
  balance: number
  voidedCount: number
}

export interface DashboardPeriod {
  currentMonth: string
  historyMonths: number
  startDate: string
  endDate: string
}

export interface DashboardPermissions {
  canViewFinancial: boolean
  canViewOperational: boolean
  canViewInventory: boolean
  canViewOperationalCharts: boolean
}

export interface DashboardRecentPayment {
  id: string
  rentalId: string
  contractNumber: string
  customerName: string
  amount: number
  method: string
  paidAt: string
}

export interface DashboardFinancial {
  totalIncome: number
  totalExpense: number
  balance: number
  recentPayments: DashboardRecentPayment[]
}

export interface DashboardUpcomingReturn {
  id: string
  contractNumber: string
  customerName: string
  expectedReturn: string
}

export interface DashboardOverdueReturn extends DashboardUpcomingReturn {
  daysOverdue: number
}

export interface DashboardRentals {
  active: number
  overdue: number
  returned: number
  canceled: number
  byStatus: { active: number; overdue: number; returned: number; canceled: number }
  upcomingReturns: DashboardUpcomingReturn[]
  overdueReturns: DashboardOverdueReturn[]
}

export interface DashboardInventory {
  totalItems: number
  availableItems: number
  rentedItems: number
  maintenanceItems: number
  occupancyRate: number
}

export interface DashboardMonthlyHistory {
  month: string
  income: number
  expense: number
  balance: number
  cumulativeIncome: number
}

export interface DashboardSummary {
  period: DashboardPeriod
  permissions: DashboardPermissions
  financial: DashboardFinancial | null
  rentals: DashboardRentals
  inventory: DashboardInventory
  monthlyHistory: DashboardMonthlyHistory[]
}
