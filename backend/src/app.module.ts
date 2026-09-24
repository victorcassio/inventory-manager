import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module';
import { HashingModule } from './modules/hashing/hashing.module';
import { MailModule } from './modules/mail/mail.module';
import { UserActionTokensModule } from './modules/user-action-tokens/user-action-tokens.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { AuditModule } from './modules/audit/audit.module';
import { CustomersModule } from './modules/customers/customers.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { RentalsModule } from './modules/rentals/rentals.module';
import { ReturnsModule } from './modules/returns/returns.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { FinancialModule } from './modules/financial/financial.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { HealthModule } from './modules/health/health.module';
import appConfig from './config/app.config';
import { ClientIpThrottlerGuard } from './common/client-ip/client-ip-throttler.guard';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig],
      envFilePath: '.env',
    }),
    ThrottlerModule.forRoot([
      {
        name: 'global',
        ttl: 60_000,
        limit: 100,
      },
    ]),
    PrismaModule,
    HashingModule,
    MailModule,
    UserActionTokensModule,
    AuthModule,
    UsersModule,
    AuditModule,
    CustomersModule,
    InventoryModule,
    RentalsModule,
    ReturnsModule,
    PaymentsModule,
    FinancialModule,
    DocumentsModule,
    DashboardModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ClientIpThrottlerGuard },
  ],
})
export class AppModule {}
