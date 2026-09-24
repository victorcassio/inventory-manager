export const MAIL_SERVICE = 'MAIL_SERVICE';

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/**
 * Provider-agnostic mail abstraction. Swapping providers means adding an
 * implementation and changing the MailModule factory — no domain service
 * touches a transport.
 */
export interface MailService {
  send(message: MailMessage): Promise<void>;
}
