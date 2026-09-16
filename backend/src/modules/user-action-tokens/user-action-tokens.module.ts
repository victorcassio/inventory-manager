import { Module } from '@nestjs/common';
import { UserActionTokensService } from './user-action-tokens.service';

@Module({
  providers: [UserActionTokensService],
  exports: [UserActionTokensService],
})
export class UserActionTokensModule {}
