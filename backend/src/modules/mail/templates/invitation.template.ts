export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface InvitationEmailData {
  name: string;
  activationUrl: string;
}

export function buildInvitationEmail({ name, activationUrl }: InvitationEmailData) {
  const safeName = escapeHtml(name);
  const safeUrl = escapeHtml(activationUrl);

  const subject = 'Convite de acesso — Inventory Manager';

  const text = [
    `Olá, ${name}!`,
    '',
    'Você recebeu um convite para acessar o Inventory Manager.',
    'Para concluir o cadastro, confirme seu e-mail e defina sua senha no link abaixo:',
    '',
    activationUrl,
    '',
    'O link é válido por 24 horas e pode ser usado uma única vez.',
    'Se você não esperava este convite, ignore esta mensagem.',
    '',
    'Inventory Manager',
  ].join('\n');

  const html = `
    <div style="font-family: system-ui, -apple-system, sans-serif; font-size: 15px; color: #111; line-height: 1.6;">
      <p>Olá, ${safeName}!</p>
      <p>Você recebeu um convite para acessar o <strong>Inventory Manager</strong>.</p>
      <p>Para concluir o cadastro, confirme seu e-mail e defina sua senha:</p>
      <p>
        <a href="${safeUrl}" style="display: inline-block; padding: 10px 18px; background: #0f172a; color: #fff; border-radius: 6px; text-decoration: none;">
          Definir minha senha
        </a>
      </p>
      <p style="font-size: 13px; color: #555;">
        Ou copie e cole este endereço no navegador:<br />
        <span style="word-break: break-all;">${safeUrl}</span>
      </p>
      <p style="font-size: 13px; color: #555;">
        O link é válido por <strong>24 horas</strong> e pode ser usado uma única vez.
        Se você não esperava este convite, ignore esta mensagem.
      </p>
      <p style="font-size: 13px; color: #555;">Inventory Manager</p>
    </div>
  `.trim();

  return { subject, html, text };
}
