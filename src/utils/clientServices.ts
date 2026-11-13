import { ClientService, ServiceProduct } from '../types';

export const CLIENT_SERVICE_TYPE_LABEL: Record<ClientService['type'], string> = {
  hospedagem: 'Hospedagem',
  website: 'Website',
  manutencao: 'Manutenção & Suporte',
  dominio: 'Domínio / SSL',
  ecommerce: 'E-commerce'
};

export const CLIENT_SERVICE_STATUS_LABEL: Record<ClientService['status'], string> = {
  ativo: 'Ativo',
  renovacao: 'Em renovação',
  suspenso: 'Suspenso'
};

export function getDefaultExpiryDate(monthsAhead = 12): string {
  const date = new Date();
  date.setMonth(date.getMonth() + monthsAhead);
  return date.toISOString().substring(0, 10);
}

export function calculateClientMrr(services: ClientService[] = []): number {
  const sum = services.reduce((acc, svc) => {
    if (!svc || svc.status === 'suspenso') return acc;
    const val = Number(svc.monthlyValue);
    return acc + (Number.isFinite(val) && val > 0 ? val : 0);
  }, 0);
  return Math.round(sum * 100) / 100;
}

export function inferClientServiceType(product: ServiceProduct): ClientService['type'] {
  const text = `${product.name || ''} ${product.category || ''}`.toLowerCase();
  if (text.includes('hosped') || text.includes('cloud') || text.includes('servidor') || product.category === 'infra') {
    return 'hospedagem';
  }
  if (text.includes('domínio') || text.includes('dominio') || text.includes('ssl')) {
    return 'dominio';
  }
  if (text.includes('manut') || text.includes('suporte')) {
    return 'manutencao';
  }
  if (text.includes('commerce') || text.includes('loja') || text.includes('woo')) {
    return 'ecommerce';
  }
  return 'website';
}

export function getCatalogMonthlyValue(product: ServiceProduct): number {
  const base = Number(product.basePrice);
  if (!Number.isFinite(base) || base <= 0) return 0;
  const cycle = product.billingCycle || (product.isRecurring ? 'mensal' : 'unico');
  if (cycle === 'anual') {
    return Math.round((base / 12) * 100) / 100;
  }
  if (cycle === 'unico') {
    return 0;
  }
  return Math.round(base * 100) / 100;
}

export function formatCatalogServicePriceLabel(product: ServiceProduct): string {
  const base = Number(product.basePrice) || 0;
  const cycle = product.billingCycle || (product.isRecurring ? 'mensal' : 'unico');
  const formatted = base.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (cycle === 'mensal') return `R$ ${formatted}/mês`;
  if (cycle === 'anual') return `R$ ${formatted}/ano`;
  return `R$ ${formatted} (único)`;
}

export function createClientServiceFromCatalog(product: ServiceProduct): ClientService {
  const cycle = product.billingCycle || (product.isRecurring ? 'mensal' : 'unico');
  return {
    id: `cs_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name: product.name,
    type: inferClientServiceType(product),
    domain: '',
    hostingServer: '',
    expiryDate: getDefaultExpiryDate(12),
    monthlyValue: getCatalogMonthlyValue(product),
    status: 'ativo',
    catalogServiceId: product.id,
    billingCycle: cycle
  };
}
