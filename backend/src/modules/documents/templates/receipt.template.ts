import * as PDFDocument from 'pdfkit';
import {
  drawField,
  drawHeader,
  drawHLine,
  drawSectionTitle,
  formatCurrency,
  formatDate,
} from './pdf-helpers';

const METHOD_LABEL: Record<string, string> = {
  cash: 'Dinheiro',
  pix: 'PIX',
  card: 'Cartão',
  transfer: 'Transferência',
};

export async function buildReceiptPdf(payment: any): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const chunks: Buffer[] = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const rental = payment.rental;
    const customer = rental?.customer;

    drawHeader(doc, 'Recibo de Pagamento', `Contrato Nº ${rental?.contractNumber ?? '—'}`);

    let y = 130;

    drawSectionTitle(doc, 'Dados do Cliente', y);
    y += 24;
    drawField(doc, 'Nome:', customer?.name ?? '', 50, y);
    y += 16;
    drawField(doc, 'Documento:', customer?.document ?? '', 50, y);

    y += 28;

    drawSectionTitle(doc, 'Dados do Pagamento', y);
    y += 24;
    drawField(doc, 'Valor Pago:', formatCurrency(payment.amount), 50, y);
    y += 16;
    drawField(doc, 'Forma de Pagamento:', METHOD_LABEL[payment.method] ?? payment.method, 50, y);
    y += 16;
    drawField(doc, 'Data do Pagamento:', formatDate(payment.paidAt), 50, y);
    if (payment.referenceCode) {
      y += 16;
      drawField(doc, 'Código de Referência:', payment.referenceCode, 50, y);
    }
    if (payment.user?.name) {
      y += 16;
      drawField(doc, 'Registrado por:', payment.user.name, 50, y);
    }
    if (payment.notes) {
      y += 16;
      drawField(doc, 'Observações:', payment.notes, 50, y);
    }

    y += 28;
    drawHLine(doc, y);
    y += 10;
    doc.fontSize(12).font('Helvetica-Bold').text(
      `VALOR RECEBIDO: ${formatCurrency(payment.amount)}`,
      50, y, { width: 495, align: 'center' },
    );

    y += 50;
    doc.moveTo(195, y + 40).lineTo(395, y + 40).strokeColor('#000000').stroke();
    doc.fontSize(8).font('Helvetica').text('Assinatura / Validação', 195, y + 44, { width: 200, align: 'center' });

    doc.fontSize(8).text(`Gerado em: ${formatDate(new Date())}`, 50, y + 80, { width: 495, align: 'right' });

    doc.end();
  });
}
