import PDFDocument from 'pdfkit';
import {
  drawField,
  drawHeader,
  drawHLine,
  drawSectionTitle,
  drawSignatureBlock,
  formatCurrency,
  formatDate,
} from './pdf-helpers';

export async function buildContractPdf(rental: any): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const chunks: Buffer[] = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    drawHeader(doc, 'Termo de Retirada / Contrato de Locação', `Contrato Nº ${rental.contractNumber}`);

    let y = 130;

    // Customer info
    drawSectionTitle(doc, 'Dados do Cliente', y);
    y += 24;
    drawField(doc, 'Nome:', rental.customer?.name ?? '', 50, y);
    y += 16;
    drawField(doc, 'Documento:', rental.customer?.document ?? '', 50, y);
    if (rental.customer?.phone) { y += 16; drawField(doc, 'Telefone:', rental.customer.phone, 50, y); }
    if (rental.customer?.email) { y += 16; drawField(doc, 'E-mail:', rental.customer.email, 50, y); }

    y += 28;

    // Rental info
    drawSectionTitle(doc, 'Dados da Locação', y);
    y += 24;
    drawField(doc, 'Data de Início:', formatDate(rental.startedAt), 50, y, 130);
    drawField(doc, 'Devolução Prevista:', formatDate(rental.expectedReturn), 295, y, 140);
    y += 16;
    drawField(doc, 'Tipo de Precificação:', rental.pricingType ?? 'daily', 50, y);

    y += 28;

    // Items table
    drawSectionTitle(doc, 'Itens Locados', y);
    y += 24;

    // Table header
    doc.rect(50, y, 495, 18).fillColor('#f0f0f0').fill();
    doc.fillColor('#000000').fontSize(8).font('Helvetica-Bold');
    doc.text('Descrição', 55, y + 5, { width: 180 });
    doc.text('Cód.', 240, y + 5, { width: 60 });
    doc.text('Qtd.', 305, y + 5, { width: 50, align: 'right' });
    doc.text('Valor Unit./dia', 355, y + 5, { width: 90, align: 'right' });
    doc.text('Subtotal', 450, y + 5, { width: 90, align: 'right' });
    y += 20;

    doc.font('Helvetica').fontSize(8);
    const days = Math.max(1, Math.ceil(
      (new Date(rental.expectedReturn).getTime() - new Date(rental.startedAt).getTime()) /
      (1000 * 60 * 60 * 24),
    ));

    for (const ri of rental.rentalItems ?? []) {
      const lineSubtotal = ri.quantity * Number(ri.unitPrice) * days;
      doc.text(ri.item?.name ?? '—', 55, y, { width: 180 });
      doc.text(ri.item?.code ?? '—', 240, y, { width: 60 });
      doc.text(String(ri.quantity), 305, y, { width: 50, align: 'right' });
      doc.text(formatCurrency(ri.unitPrice), 355, y, { width: 90, align: 'right' });
      doc.text(formatCurrency(lineSubtotal), 450, y, { width: 90, align: 'right' });
      y += 16;
      drawHLine(doc, y - 2);
    }

    y += 10;

    // Totals
    drawSectionTitle(doc, 'Resumo Financeiro', y);
    y += 24;
    drawField(doc, 'Subtotal:', formatCurrency(rental.subtotal), 295, y, 100);
    if (Number(rental.discount) > 0) { y += 16; drawField(doc, 'Desconto:', `- ${formatCurrency(rental.discount)}`, 295, y, 100); }
    if (Number(rental.extraCosts) > 0) { y += 16; drawField(doc, 'Custos Extras:', formatCurrency(rental.extraCosts), 295, y, 100); }
    if (Number(rental.deposit) > 0) { y += 16; drawField(doc, 'Caução:', formatCurrency(rental.deposit), 295, y, 100); }
    y += 16;
    doc.fontSize(10).font('Helvetica-Bold');
    drawField(doc, 'TOTAL:', formatCurrency(rental.total), 295, y, 100);
    doc.fontSize(9).font('Helvetica');

    if (rental.notes) {
      y += 28;
      drawSectionTitle(doc, 'Observações', y);
      y += 24;
      doc.fontSize(9).text(rental.notes, 50, y, { width: 495 });
    }

    y += 50;
    drawSignatureBlock(doc, y);
    doc.fontSize(8).text(`Gerado em: ${formatDate(new Date())}`, 50, y + 80, { width: 495, align: 'right' });

    doc.end();
  });
}
