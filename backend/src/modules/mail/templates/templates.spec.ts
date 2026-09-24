import { buildInvitationEmail } from './invitation.template';
import { buildPasswordResetEmail } from './password-reset.template';

describe('mail templates', () => {
  const activationUrl = 'http://localhost:5173/activate-account#token=RAW_TOKEN_VALUE';
  const resetUrl = 'http://localhost:5173/reset-password#token=RAW_TOKEN_VALUE';

  describe('buildInvitationEmail', () => {
    const mail = buildInvitationEmail({ name: 'Maria Silva', activationUrl });

    it('is written in Portuguese', () => {
      expect(mail.subject).toMatch(/convite|acesso/i);
      expect(mail.text).toMatch(/senha/i);
    });

    it('includes the activation link in both parts', () => {
      expect(mail.html).toContain(activationUrl);
      expect(mail.text).toContain(activationUrl);
    });

    it('greets the invited user by name', () => {
      expect(mail.text).toContain('Maria Silva');
    });

    it('states the 24-hour validity', () => {
      expect(mail.text).toMatch(/24 horas/);
    });

    it('does not contain a provisional password', () => {
      expect(mail.text.toLowerCase()).not.toMatch(/senha provis|senha tempor|sua senha é/);
      expect(mail.html.toLowerCase()).not.toMatch(/senha provis|senha tempor|sua senha é/);
    });

    it('escapes the user name so it cannot inject markup', () => {
      const hostile = buildInvitationEmail({
        name: '<script>alert(1)</script>',
        activationUrl,
      });
      expect(hostile.html).not.toContain('<script>');
      expect(hostile.html).toContain('&lt;script&gt;');
    });
  });

  describe('buildPasswordResetEmail', () => {
    const mail = buildPasswordResetEmail({ name: 'Maria Silva', resetUrl });

    it('includes the reset link', () => {
      expect(mail.html).toContain(resetUrl);
      expect(mail.text).toContain(resetUrl);
    });

    it('states the 30-minute validity', () => {
      expect(mail.text).toMatch(/30 minutos/);
    });

    it('tells the recipient to ignore it if they did not ask', () => {
      expect(mail.text.toLowerCase()).toContain('ignore');
    });

    it('does not contain a provisional password', () => {
      expect(mail.text.toLowerCase()).not.toMatch(/senha provis|senha tempor|sua senha é/);
    });
  });
});
