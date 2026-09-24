import { escapeHtml } from './invitation.template';

export interface PasswordResetEmailData {
  name: string;
  resetUrl: string;
}

export function buildPasswordResetEmail({ name, resetUrl }: PasswordResetEmailData) {
  const safeName = escapeHtml(name);
  const safeUrl = escapeHtml(resetUrl);

  const subject = 'Redefinição de senha — Inventory Manager';

  const text = [
    `Olá, ${name}!`,
    '',
    'Recebemos uma solicitação para redefinir a senha da sua conta no Inventory Manager.',
    'Se foi você, use o link abaixo para escolher uma nova senha:',
    '',
    resetUrl,
    '',
    'O link é válido por 30 minutos e pode ser usado uma única vez.',
    'Se você não solicitou a redefinição, ignore esta mensagem — sua senha atual continua valendo.',
    '',
    'Inventory Manager',
  ].join('\n');

  const html = `
    <div style="font-family: system-ui, -apple-system, sans-serif; font-size: 15px; color: #111; line-height: 1.6;">
      <p>Olá, ${safeName}!</p>
      <p>Recebemos uma solicitação para redefinir a senha da sua conta no <strong>Inventory Manager</strong>.</p>
      <p>
        <a href="${safeUrl}" style="display: inline-block; padding: 10px 18px; background: #0f172a; color: #fff; border-radius: 6px; text-decoration: none;">
          Redefinir minha senha
        </a>
      </p>
      <p style="font-size: 13px; color: #555;">
        Ou copie e cole este endereço no navegador:<br />
        <span style="word-break: break-all;">${safeUrl}</span>
      </p>
      <p style="font-size: 13px; color: #555;">
        O link é válido por <strong>30 minutos</strong> e pode ser usado uma única vez.
        Se você não solicitou a redefinição, ignore esta mensagem — sua senha atual continua valendo.
      </p>
      <p style="font-size: 13px; color: #555;">Inventory Manager</p>
    </div>
  `.trim();

  return { subject, html, text };
}
