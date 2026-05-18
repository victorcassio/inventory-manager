import {
  PrismaClient,
  UserRole,
  RentalStatus,
  PricingType,
  PaymentMethod,
  FinancialTransactionType,
  FinancialTransactionCategory,
  FinancialTransactionOrigin,
} from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcrypt';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const connectionString = process.env.DATABASE_URL ?? '';
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter } as any);

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

function daysFromNow(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(0, 0, 0, 0);
  return d;
}

function monthStart(monthsAgo: number): Date {
  const d = new Date();
  d.setMonth(d.getMonth() - monthsAgo, 1);
  d.setHours(0, 0, 0, 0);
  return d;
}

function monthMid(monthsAgo: number, day = 15): Date {
  const d = new Date();
  d.setMonth(d.getMonth() - monthsAgo, day);
  d.setHours(12, 0, 0, 0);
  return d;
}

async function main() {
  console.log('🌱 Iniciando seed de dados demo...');

  // ─── Users ───────────────────────────────────────────────────────────────
  const hashed = await bcrypt.hash('Admin@123456', 12);

  const admin = await prisma.user.upsert({
    where: { email: 'admin@inventory.local' },
    update: {},
    create: { name: 'Administrador', email: 'admin@inventory.local', password: hashed, role: UserRole.admin },
  });

  const attendant = await prisma.user.upsert({
    where: { email: 'atendente@inventory.local' },
    update: {},
    create: { name: 'Carlos Atendente', email: 'atendente@inventory.local', password: hashed, role: UserRole.attendant },
  });

  const financial = await prisma.user.upsert({
    where: { email: 'financeiro@inventory.local' },
    update: {},
    create: { name: 'Ana Financeiro', email: 'financeiro@inventory.local', password: hashed, role: UserRole.financial },
  });

  console.log('✓ Usuários criados');

  // ─── Customers ───────────────────────────────────────────────────────────
  const customers = await Promise.all([
    prisma.customer.upsert({
      where: { document: '12345678000195' },
      update: {},
      create: {
        name: 'Construtora Alfa LTDA',
        document: '12345678000195',
        documentType: 'cnpj',
        phone: '(11) 3333-4444',
        email: 'contato@alfa.com.br',
        isActive: true,
      },
    }),
    prisma.customer.upsert({
      where: { document: '98765432000110' },
      update: {},
      create: {
        name: 'Beta Engenharia S/A',
        document: '98765432000110',
        documentType: 'cnpj',
        phone: '(11) 4444-5555',
        email: 'compras@beta.com.br',
        isActive: true,
      },
    }),
    prisma.customer.upsert({
      where: { document: '11122233344' },
      update: {},
      create: {
        name: 'João Silva',
        document: '11122233344',
        documentType: 'cpf',
        phone: '(11) 98765-4321',
        email: 'joao.silva@email.com',
        isActive: true,
      },
    }),
    prisma.customer.upsert({
      where: { document: '55566677788' },
      update: {},
      create: {
        name: 'Maria Souza',
        document: '55566677788',
        documentType: 'cpf',
        phone: '(11) 97654-3210',
        email: 'maria.souza@email.com',
        isActive: true,
      },
    }),
    prisma.customer.upsert({
      where: { document: '44455566600' },
      update: {},
      create: {
        name: 'Pedro Construções ME',
        document: '44455566600',
        documentType: 'cpf',
        phone: '(11) 96543-2109',
        isActive: true,
      },
    }),
    prisma.customer.upsert({
      where: { document: '33344455500' },
      update: {},
      create: {
        name: 'Gama Obras LTDA',
        document: '33344455500',
        documentType: 'cpf',
        phone: '(11) 95432-1098',
        email: 'gama@obras.com',
        isActive: true,
      },
    }),
  ]);

  console.log('✓ Clientes criados');

  // ─── Item Categories ──────────────────────────────────────────────────────
  async function findOrCreateCategory(name: string, description: string) {
    const existing = await prisma.itemCategory.findFirst({ where: { name } });
    if (existing) return existing;
    return prisma.itemCategory.create({ data: { name, description, isActive: true } });
  }

  const catAndaimes    = await findOrCreateCategory('Andaimes', 'Estruturas metálicas para andaimes');
  const catEscoras     = await findOrCreateCategory('Escoras', 'Escoras metálicas e telescópicas');
  const catFormas      = await findOrCreateCategory('Formas', 'Formas para concreto');
  const catEquipamentos = await findOrCreateCategory('Equipamentos', 'Equipamentos de construção');

  console.log('✓ Categorias criadas');

  // ─── Items ────────────────────────────────────────────────────────────────
  const items = await Promise.all([
    prisma.item.upsert({
      where: { code: 'AND-1M' },
      update: {},
      create: {
        categoryId: catAndaimes.id,
        name: 'Andaime Tubular 1m',
        code: 'AND-1M',
        dailyRate: '4.50',
        totalQty: 200,
        availableQty: 120,
        rentedQty: 75,
        maintenanceQty: 5,
        condition: 'good',
        isActive: true,
      },
    }),
    prisma.item.upsert({
      where: { code: 'AND-2M' },
      update: {},
      create: {
        categoryId: catAndaimes.id,
        name: 'Andaime Tubular 2m',
        code: 'AND-2M',
        dailyRate: '7.00',
        totalQty: 150,
        availableQty: 80,
        rentedQty: 65,
        maintenanceQty: 5,
        condition: 'good',
        isActive: true,
      },
    }),
    prisma.item.upsert({
      where: { code: 'ESC-3M' },
      update: {},
      create: {
        categoryId: catEscoras.id,
        name: 'Escora Metálica 3m',
        code: 'ESC-3M',
        dailyRate: '3.50',
        totalQty: 100,
        availableQty: 40,
        rentedQty: 58,
        maintenanceQty: 2,
        condition: 'good',
        isActive: true,
      },
    }),
    prisma.item.upsert({
      where: { code: 'ESC-4M' },
      update: {},
      create: {
        categoryId: catEscoras.id,
        name: 'Escora Metálica 4m',
        code: 'ESC-4M',
        dailyRate: '4.50',
        totalQty: 80,
        availableQty: 35,
        rentedQty: 43,
        maintenanceQty: 2,
        condition: 'good',
        isActive: true,
      },
    }),
    prisma.item.upsert({
      where: { code: 'FOR-60' },
      update: {},
      create: {
        categoryId: catFormas.id,
        name: 'Forma de Alumínio 60cm',
        code: 'FOR-60',
        dailyRate: '2.00',
        totalQty: 500,
        availableQty: 300,
        rentedQty: 198,
        maintenanceQty: 2,
        condition: 'good',
        isActive: true,
      },
    }),
    prisma.item.upsert({
      where: { code: 'GER-5KW' },
      update: {},
      create: {
        categoryId: catEquipamentos.id,
        name: 'Gerador 5KVA',
        code: 'GER-5KW',
        dailyRate: '120.00',
        totalQty: 5,
        availableQty: 3,
        rentedQty: 2,
        maintenanceQty: 0,
        condition: 'good',
        isActive: true,
      },
    }),
    prisma.item.upsert({
      where: { code: 'VIB-ELE' },
      update: {},
      create: {
        categoryId: catEquipamentos.id,
        name: 'Vibrador de Concreto Elétrico',
        code: 'VIB-ELE',
        dailyRate: '45.00',
        totalQty: 8,
        availableQty: 5,
        rentedQty: 3,
        maintenanceQty: 0,
        condition: 'good',
        isActive: true,
      },
    }),
  ]);

  const allItems = await prisma.item.findMany({ where: { isActive: true } });
  const itemMap = Object.fromEntries(allItems.map(i => [i.code, i]));

  console.log('✓ Itens criados');

  // ─── ContractCounter ──────────────────────────────────────────────────────
  const year = new Date().getFullYear();
  await prisma.contractCounter.upsert({
    where: { year },
    update: {},
    create: { year, lastSeq: 0 },
  });

  // ─── Helper: create rental with items ────────────────────────────────────
  async function createRental(opts: {
    customer: typeof customers[0];
    user: typeof admin;
    startedAt: Date;
    expectedReturn: Date;
    status: RentalStatus;
    returnedAt?: Date;
    items: { code: string; qty: number }[];
    pricingType?: PricingType;
    notes?: string;
  }) {
    const counter = await prisma.contractCounter.update({
      where: { year },
      data: { lastSeq: { increment: 1 } },
    });
    const contractNumber = `${year}-${String(counter.lastSeq).padStart(4, '0')}`;

    const dailyRate = opts.items.reduce((sum, it) => {
      const item = itemMap[it.code];
      return sum + (item ? Number(item.dailyRate) * it.qty : 0);
    }, 0);

    const days = Math.max(1, Math.ceil(
      (opts.expectedReturn.getTime() - opts.startedAt.getTime()) / (1000 * 60 * 60 * 24),
    ));
    const subtotal = dailyRate * days;

    const rental = await prisma.rental.create({
      data: {
        customerId: opts.customer.id,
        userId: opts.user.id,
        contractNumber,
        status: opts.status,
        pricingType: opts.pricingType ?? PricingType.daily,
        startedAt: opts.startedAt,
        expectedReturn: opts.expectedReturn,
        returnedAt: opts.returnedAt ?? null,
        deposit: '0',
        discount: '0',
        lateFee: '0',
        extraCosts: '0',
        paidAmount: '0',
        subtotal,
        total: subtotal,
        notes: opts.notes,
        rentalItems: {
          create: opts.items.map(it => ({
            itemId: itemMap[it.code].id,
            quantity: it.qty,
            unitPrice: itemMap[it.code].dailyRate,
            returnedQty: opts.status === RentalStatus.returned ? it.qty : 0,
          })),
        },
      },
    });

    return rental;
  }

  // ─── Rentals (mix of statuses and dates) ──────────────────────────────────
  // Active rentals (not overdue)
  const r1 = await createRental({
    customer: customers[0], user: attendant,
    startedAt: daysAgo(10), expectedReturn: daysFromNow(5),
    status: RentalStatus.active,
    items: [{ code: 'AND-1M', qty: 50 }, { code: 'AND-2M', qty: 20 }],
    notes: 'Obra Av. Paulista 1000',
  });

  const r2 = await createRental({
    customer: customers[1], user: attendant,
    startedAt: daysAgo(5), expectedReturn: daysFromNow(10),
    status: RentalStatus.active,
    items: [{ code: 'ESC-3M', qty: 30 }, { code: 'ESC-4M', qty: 20 }],
    notes: 'Edifício Centro Empresarial',
  });

  const r3 = await createRental({
    customer: customers[2], user: attendant,
    startedAt: daysAgo(3), expectedReturn: daysFromNow(4),
    status: RentalStatus.active,
    items: [{ code: 'AND-1M', qty: 20 }, { code: 'GER-5KW', qty: 1 }],
  });

  const r4 = await createRental({
    customer: customers[4], user: attendant,
    startedAt: daysAgo(7), expectedReturn: daysFromNow(3),
    status: RentalStatus.active,
    items: [{ code: 'VIB-ELE', qty: 2 }, { code: 'FOR-60', qty: 100 }],
  });

  // Overdue rentals (active but past expectedReturn)
  const r5 = await createRental({
    customer: customers[3], user: attendant,
    startedAt: daysAgo(20), expectedReturn: daysAgo(5),
    status: RentalStatus.active,
    items: [{ code: 'AND-1M', qty: 30 }, { code: 'ESC-3M', qty: 15 }],
    notes: 'Cliente informou atraso na obra',
  });

  const r6 = await createRental({
    customer: customers[5], user: attendant,
    startedAt: daysAgo(30), expectedReturn: daysAgo(8),
    status: RentalStatus.active,
    items: [{ code: 'AND-2M', qty: 25 }],
  });

  // Returned rentals (various months)
  const returnedRentals = await Promise.all([
    createRental({
      customer: customers[0], user: attendant,
      startedAt: daysAgo(45), expectedReturn: daysAgo(30),
      status: RentalStatus.returned, returnedAt: daysAgo(31),
      items: [{ code: 'AND-1M', qty: 40 }],
    }),
    createRental({
      customer: customers[1], user: attendant,
      startedAt: daysAgo(60), expectedReturn: daysAgo(40),
      status: RentalStatus.returned, returnedAt: daysAgo(40),
      items: [{ code: 'ESC-3M', qty: 20 }, { code: 'ESC-4M', qty: 10 }],
    }),
    createRental({
      customer: customers[2], user: attendant,
      startedAt: daysAgo(90), expectedReturn: daysAgo(60),
      status: RentalStatus.returned, returnedAt: daysAgo(62),
      items: [{ code: 'AND-2M', qty: 30 }],
    }),
    createRental({
      customer: customers[3], user: attendant,
      startedAt: daysAgo(120), expectedReturn: daysAgo(90),
      status: RentalStatus.returned, returnedAt: daysAgo(90),
      items: [{ code: 'FOR-60', qty: 150 }, { code: 'VIB-ELE', qty: 1 }],
    }),
    createRental({
      customer: customers[4], user: attendant,
      startedAt: daysAgo(150), expectedReturn: daysAgo(120),
      status: RentalStatus.returned, returnedAt: daysAgo(121),
      items: [{ code: 'AND-1M', qty: 60 }, { code: 'GER-5KW', qty: 2 }],
    }),
    createRental({
      customer: customers[5], user: attendant,
      startedAt: daysAgo(180), expectedReturn: daysAgo(150),
      status: RentalStatus.returned, returnedAt: daysAgo(150),
      items: [{ code: 'ESC-4M', qty: 15 }, { code: 'ESC-3M', qty: 10 }],
    }),
  ]);

  // Canceled rental
  await createRental({
    customer: customers[2], user: attendant,
    startedAt: daysAgo(15), expectedReturn: daysAgo(5),
    status: RentalStatus.canceled,
    items: [{ code: 'AND-1M', qty: 10 }],
    notes: 'Cliente cancelou — obra embargada',
  });

  console.log('✓ Locações criadas');

  // ─── Payments ─────────────────────────────────────────────────────────────
  async function createPayment(rentalId: string, amount: number, method: PaymentMethod, daysAgoN: number, userId: string) {
    const paidAt = new Date(); paidAt.setDate(paidAt.getDate() - daysAgoN);
    const payment = await prisma.payment.create({
      data: {
        rentalId,
        userId,
        amount: amount.toString(),
        method,
        paidAt,
        notes: null,
      },
    });
    await prisma.rental.update({
      where: { id: rentalId },
      data: { paidAmount: { increment: amount } },
    });
    await prisma.financialTransaction.create({
      data: {
        userId,
        rentalId,
        paymentId: payment.id,
        type: FinancialTransactionType.income,
        category: FinancialTransactionCategory.rental_income,
        origin: FinancialTransactionOrigin.payment,
        amount: amount.toString(),
        description: `Pagamento recebido`,
        date: paidAt,
      },
    });
    return payment;
  }

  // Payments for active rentals
  await createPayment(r1.id, 2500, PaymentMethod.pix, 8, admin.id);
  await createPayment(r2.id, 1800, PaymentMethod.transfer, 4, financial.id);
  await createPayment(r3.id, 650, PaymentMethod.cash, 2, attendant.id);
  await createPayment(r4.id, 1200, PaymentMethod.card, 5, financial.id);

  // Payments for returned rentals (full amounts)
  await createPayment(returnedRentals[0].id, 5400, PaymentMethod.pix, 35, financial.id);
  await createPayment(returnedRentals[1].id, 4200, PaymentMethod.transfer, 45, financial.id);
  await createPayment(returnedRentals[2].id, 6300, PaymentMethod.pix, 65, financial.id);
  await createPayment(returnedRentals[3].id, 8900, PaymentMethod.transfer, 95, financial.id);
  await createPayment(returnedRentals[4].id, 12500, PaymentMethod.pix, 125, financial.id);
  await createPayment(returnedRentals[5].id, 3800, PaymentMethod.transfer, 155, financial.id);

  console.log('✓ Pagamentos criados');

  // ─── Manual Financial Transactions (expenses) ─────────────────────────────
  const expenses = [
    { type: FinancialTransactionType.expense, category: FinancialTransactionCategory.maintenance, amount: 850, description: 'Manutenção andaimes lote A', daysAgo: 3 },
    { type: FinancialTransactionType.expense, category: FinancialTransactionCategory.maintenance, amount: 420, description: 'Pintura e anticorrosivo escoras', daysAgo: 10 },
    { type: FinancialTransactionType.expense, category: FinancialTransactionCategory.transport, amount: 680, description: 'Frete entrega Av. Paulista', daysAgo: 9 },
    { type: FinancialTransactionType.expense, category: FinancialTransactionCategory.transport, amount: 540, description: 'Frete retirada obra Moema', daysAgo: 6 },
    { type: FinancialTransactionType.expense, category: FinancialTransactionCategory.fixed_cost, amount: 3200, description: 'Aluguel galpão — maio/2026', daysAgo: 1 },
    { type: FinancialTransactionType.expense, category: FinancialTransactionCategory.fixed_cost, amount: 1800, description: 'Folha de pagamento ajudantes', daysAgo: 2 },
    { type: FinancialTransactionType.expense, category: FinancialTransactionCategory.stock_investment, amount: 4500, description: 'Compra 50 andaimes novos 1m', daysAgo: 20 },
    { type: FinancialTransactionType.expense, category: FinancialTransactionCategory.maintenance, amount: 320, description: 'Manutenção gerador 5KVA', daysAgo: 35 },
    { type: FinancialTransactionType.expense, category: FinancialTransactionCategory.fixed_cost, amount: 3200, description: 'Aluguel galpão — abril/2026', daysAgo: 31 },
    { type: FinancialTransactionType.expense, category: FinancialTransactionCategory.transport, amount: 760, description: 'Frete entrega Santana', daysAgo: 40 },
    { type: FinancialTransactionType.expense, category: FinancialTransactionCategory.fixed_cost, amount: 3200, description: 'Aluguel galpão — março/2026', daysAgo: 62 },
    { type: FinancialTransactionType.expense, category: FinancialTransactionCategory.maintenance, amount: 1100, description: 'Revisão equipamentos', daysAgo: 70 },
    { type: FinancialTransactionType.expense, category: FinancialTransactionCategory.fixed_cost, amount: 3200, description: 'Aluguel galpão — fev/2026', daysAgo: 93 },
    { type: FinancialTransactionType.expense, category: FinancialTransactionCategory.stock_investment, amount: 6800, description: 'Compra formas alumínio', daysAgo: 100 },
    { type: FinancialTransactionType.expense, category: FinancialTransactionCategory.fixed_cost, amount: 3200, description: 'Aluguel galpão — jan/2026', daysAgo: 124 },
    { type: FinancialTransactionType.expense, category: FinancialTransactionCategory.maintenance, amount: 900, description: 'Manutenção preventiva geral', daysAgo: 130 },
    { type: FinancialTransactionType.expense, category: FinancialTransactionCategory.fixed_cost, amount: 3200, description: 'Aluguel galpão — dez/2025', daysAgo: 155 },
    { type: FinancialTransactionType.expense, category: FinancialTransactionCategory.transport, amount: 480, description: 'Frete especial dez/2025', daysAgo: 160 },
  ];

  for (const e of expenses) {
    const date = new Date(); date.setDate(date.getDate() - e.daysAgo);
    await prisma.financialTransaction.create({
      data: {
        userId: financial.id,
        type: e.type,
        category: e.category,
        origin: FinancialTransactionOrigin.manual,
        amount: e.amount.toString(),
        description: e.description,
        date,
      },
    });
  }

  // Manual income (extra)
  const extraIncomes = [
    { category: FinancialTransactionCategory.other, amount: 500, description: 'Serviço de montagem andaimes', daysAgo: 7 },
    { category: FinancialTransactionCategory.other, amount: 350, description: 'Serviço de montagem andaimes', daysAgo: 38 },
    { category: FinancialTransactionCategory.other, amount: 420, description: 'Taxa de entrega urgente', daysAgo: 65 },
  ];

  for (const e of extraIncomes) {
    const date = new Date(); date.setDate(date.getDate() - e.daysAgo);
    await prisma.financialTransaction.create({
      data: {
        userId: financial.id,
        type: FinancialTransactionType.income,
        category: e.category,
        origin: FinancialTransactionOrigin.manual,
        amount: e.amount.toString(),
        description: e.description,
        date,
      },
    });
  }

  console.log('✓ Transações financeiras criadas');

  console.log('\n✅ Seed demo concluído!');
  console.log('\n📋 Credenciais:');
  console.log('  admin@inventory.local     / Admin@123456 (admin)');
  console.log('  atendente@inventory.local / Admin@123456 (attendant)');
  console.log('  financeiro@inventory.local/ Admin@123456 (financial)');
}

main()
  .catch((e) => {
    console.error('❌ Erro no seed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
