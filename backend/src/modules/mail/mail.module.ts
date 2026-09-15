import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MAIL_SERVICE } from './mail.service';
import { FakeMailService } from './fake-mail.service';
import { SmtpMailService } from './smtp-mail.service';

@Module({
  providers: [
    FakeMailService,
    SmtpMailService,
    {
      provide: MAIL_SERVICE,
      inject: [ConfigService, FakeMailService, SmtpMailService],
      useFactory: (
        configService: ConfigService,
        fake: FakeMailService,
        smtp: SmtpMailService,
      ) => (configService.get<string>('app.mail.driver') === 'smtp' ? smtp : fake),
    },
  ],
  exports: [MAIL_SERVICE, FakeMailService],
})
export class MailModule {}
