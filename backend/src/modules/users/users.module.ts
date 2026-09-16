import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { HashingModule } from '../hashing/hashing.module';
import { MailModule } from '../mail/mail.module';
import { UserActionTokensModule } from '../user-action-tokens/user-action-tokens.module';
import { UsersService } from './users.service';
import { InvitationsService } from './invitations.service';

@Module({
  imports: [PrismaModule, AuditModule, HashingModule, MailModule, UserActionTokensModule],
  providers: [UsersService, InvitationsService],
  exports: [UsersService, InvitationsService],
})
export class UsersModule {}
