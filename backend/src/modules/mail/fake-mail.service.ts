import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailMessage, MailService } from './mail.service';

/**
 * Non-sending driver for development and tests.
 *
 * In tests it retains messages so a spec can read the activation link.
 * Everywhere else it retains nothing and logs only the recipient, the subject
 * and a fixed marker — never a token, never a URL.
 */
@Injectable()
export class FakeMailService implements MailService {
  private readonly logger = new Logger(FakeMailService.name);
  private readonly messages: MailMessage[] = [];

  constructor(private readonly configService: ConfigService) {}

  get sent(): MailMessage[] {
    return this.messages;
  }

  reset(): void {
    this.messages.length = 0;
  }

  async send(message: MailMessage): Promise<void> {
    if (this.isTestEnv()) {
      this.messages.push(message);
      return;
    }

    this.logger.log(`[mail:fake] destinatário=${message.to} assunto="${message.subject}" (conteúdo omitido)`);
  }

  private isTestEnv(): boolean {
    return (this.configService.get<string>('app.nodeEnv') ?? process.env.NODE_ENV) === 'test';
  }
}
