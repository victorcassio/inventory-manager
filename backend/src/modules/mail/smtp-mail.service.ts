import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { MailMessage, MailService } from './mail.service';

@Injectable()
export class SmtpMailService implements MailService {
  private readonly logger = new Logger(SmtpMailService.name);
  private transporter: nodemailer.Transporter | null = null;

  constructor(private readonly configService: ConfigService) {}

  async send(message: MailMessage): Promise<void> {
    const from = this.configService.get<string>('app.mail.smtp.from');

    await this.getTransporter().sendMail({
      from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
  }

  private getTransporter(): nodemailer.Transporter {
    if (this.transporter) return this.transporter;

    const smtp = this.configService.get<{
      host: string;
      port: number;
      secure: boolean;
      user: string;
      password: string;
    }>('app.mail.smtp');

    this.transporter = nodemailer.createTransport({
      host: smtp?.host,
      port: smtp?.port,
      secure: smtp?.secure,
      auth: smtp?.user ? { user: smtp.user, pass: smtp.password } : undefined,
    });

    return this.transporter;
  }
}
