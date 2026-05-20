export function getIsMobile(): boolean {
  return typeof window !== 'undefined' && window.innerWidth < 768
}

export function getEventTitle(
  contractNumber: string,
  customerName: string,
  isMobile: boolean,
): string {
  if (isMobile) return `#${contractNumber} · ${customerName}`
  return `Contrato ${contractNumber} · ${customerName}`
}
