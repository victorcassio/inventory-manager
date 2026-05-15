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

const CONDITION_LABEL: Record<string, string> = {
  good: 'Bom estado',
  damaged: 'Danificado',
  lost: 'Extraviado',
};

export async function buildReturnProofPdf(returnRecord: any): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const chunks: Buffer[] = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const rental = returnRecord.rental;
    const customer = rental?.customer;

    drawHeader(doc, 'Comprovante de Devolução', `Contrato Nº ${rental?.contractNumber ?? '—'}`);

    let y = 130;

    drawSectionTitle(doc, 'Dados do Cliente', y);
    y += 24;
    drawField(doc, 'Nome:', customer?.name ?? '', 50, y);
    y += 16;
    drawField(doc, 'Documento:', customer?.document ?? '', 50, y);

    y += 28;

    drawSectionTitle(doc, 'Dados da Devolução', y);
    y += 24;
    drawField(doc, 'Data da Devolução:', formatDate(returnRecord.returnedAt), 50, y, 130);
    drawField(doc, 'Tipo:', returnRecord.isPartial ? 'Parcial' : 'Total', 295, y, 60);
    if (returnRecord.lateDays > 0) {
      y += 16;
      drawField(doc, 'Dias de Atraso:', String(returnRecord.lateDays), 50, y, 130);
      drawField(doc, 'Multa por Atraso:', formatCurrency(returnRecord.lateFee), 295, y, 130);
    }

    y += 28;

    drawSectionTitle(doc, 'Itens Devolvidos', y);
    y += 24;

    // Table header
    doc.rect(50, y, 495, 18).fillColor('#f0f0f0').fill();
    doc.fillColor('#000000').fontSize(8).font('Helvetica-Bold');
    doc.text('Item', 55, y + 5, { width: 180 });
    doc.text('Qtd.', 240, y + 5, { width: 50, align: 'right' });
    doc.text('Condição', 295, y + 5, { width: 100 });
    doc.text('Taxa Dano', 400, y + 5, { width: 90, align: 'right' });
    y += 20;

    doc.font('Helvetica').fontSize(8);
    for (const ri of returnRecord.returnItems ?? []) {
      const itemName = ri.rentalItem?.item?.name ?? '—';
      doc.text(itemName, 55, y, { width: 180 });
      doc.text(String(ri.quantity), 240, y, { width: 50, align: 'right' });
      doc.text(CONDITION_LABEL[ri.condition] ?? ri.condition, 295, y, { width: 100 });
      doc.text(Number(ri.damageFee) > 0 ? formatCurrency(ri.damageFee) : '—', 400, y, { width: 90, align: 'right' });
      if (ri.notes) {
        y += 12;
        doc.fontSize(7).font('Helvetica-Oblique').text(`Obs: ${ri.notes}`, 55, y, { width: 480 });
        doc.font('Helvetica').fontSize(8);
      }
      y += 14;
      drawHLine(doc, y - 2);
    }

    y += 10;
    if (returnRecord.notes) {
      drawSectionTitle(doc, 'Observações', y);
      y += 24;
      doc.fontSize(9).text(returnRecord.notes, 50, y, { width: 495 });
      y += 20;
    }

    y += 20;
    drawSignatureBlock(doc, y);
    doc.fontSize(8).text(`Gerado em: ${formatDate(new Date())}`, 50, y + 80, { width: 495, align: 'right' });

    doc.end();
  });
}
