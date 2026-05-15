import type PDFDocument from 'pdfkit';

export function formatCurrency(value: any): string {
  return `R$ ${Number(value ?? 0).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
}

export function formatDate(date: Date | string): string {
  const d = new Date(date);
  return d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

export function drawHLine(doc: InstanceType<typeof PDFDocument>, y: number): void {
  doc.moveTo(50, y).lineTo(545, y).strokeColor('#cccccc').stroke();
}

export function drawHeader(
  doc: InstanceType<typeof PDFDocument>,
  title: string,
  subtitle?: string,
): void {
  doc.rect(50, 50, 495, 60).fillColor('#1a1a2e').fill();
  doc.fillColor('#ffffff').fontSize(18).font('Helvetica-Bold').text(title, 60, 65, { width: 475 });
  if (subtitle) {
    doc.fontSize(10).font('Helvetica').text(subtitle, 60, 88, { width: 475 });
  }
  doc.fillColor('#000000');
}

export function drawSectionTitle(
  doc: InstanceType<typeof PDFDocument>,
  text: string,
  y: number,
): void {
  doc.fontSize(11).font('Helvetica-Bold').fillColor('#1a1a2e').text(text, 50, y);
  drawHLine(doc, y + 14);
  doc.fillColor('#000000');
}

export function drawField(
  doc: InstanceType<typeof PDFDocument>,
  label: string,
  value: string,
  x: number,
  y: number,
  labelWidth = 120,
): void {
  doc.fontSize(9).font('Helvetica-Bold').text(label, x, y, { width: labelWidth, lineBreak: false });
  doc.font('Helvetica').text(value, x + labelWidth, y, { width: 300 - labelWidth, lineBreak: false });
}

export function drawSignatureBlock(
  doc: InstanceType<typeof PDFDocument>,
  y: number,
): void {
  const sigY = y + 40;
  doc.moveTo(50, sigY).lineTo(250, sigY).strokeColor('#000000').stroke();
  doc.moveTo(295, sigY).lineTo(545, sigY).strokeColor('#000000').stroke();
  doc.fontSize(8).font('Helvetica')
    .text('Assinatura do Cliente', 50, sigY + 4, { width: 200, align: 'center' })
    .text('Assinatura da Empresa', 295, sigY + 4, { width: 250, align: 'center' });
}
