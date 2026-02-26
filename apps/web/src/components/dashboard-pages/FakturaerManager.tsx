'use client';

import { useState, useEffect, useCallback } from 'react';

interface Invoice {
  id: string;
  number: string | null;
  status: string | null;
  amount: number;
  currency: string;
  created: number;
  period_start: number;
  period_end: number;
  hosted_invoice_url: string | null;
  invoice_pdf: string | null;
  description: string;
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  return date.toLocaleDateString('nb-NO', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function formatPeriod(start: number, end: number): string {
  const startDate = new Date(start * 1000);
  const endDate = new Date(end * 1000);
  return `${startDate.toLocaleDateString('nb-NO', { day: 'numeric', month: 'short' })} - ${endDate.toLocaleDateString('nb-NO', { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

function formatAmount(amount: number, currency: string): string {
  return new Intl.NumberFormat('nb-NO', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(amount / 100);
}

function getStatusBadge(status: string | null): { label: string; className: string } {
  const statusMap: Record<string, { label: string; className: string }> = {
    paid: { label: 'Betalt', className: 'bg-green-500/10 text-green-400' },
    open: { label: 'Åpen', className: 'bg-blue-500/10 text-blue-400' },
    draft: { label: 'Utkast', className: 'bg-dark-600/50 text-dark-400' },
    uncollectible: { label: 'Ikke innkrevd', className: 'bg-red-500/10 text-red-400' },
    void: { label: 'Annullert', className: 'bg-dark-600/50 text-dark-400' },
  };

  return statusMap[status || ''] || { label: status || 'Ukjent', className: 'bg-dark-600/50 text-dark-400' };
}

export function FakturaerManager() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadInvoices = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/dashboard/invoices');
      const result = await res.json();

      if (!res.ok) {
        throw new Error(result.error || 'Kunne ikke laste fakturaer');
      }

      setInvoices(result.invoices || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadInvoices();
  }, [loadInvoices]);

  return (
    <>
      {/* Page Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white mb-2">Fakturaer</h1>
        <p className="text-dark-400">Se og last ned tidligere fakturaer.</p>
      </div>

      {/* Loading State */}
      {loading && (
        <div className="glass-card p-8 text-center">
          <svg className="w-8 h-8 text-primary-400 animate-spin mx-auto mb-4" fill="none" viewBox="0 0 24 24" aria-hidden="true">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <p className="text-dark-400">Laster fakturaer...</p>
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && invoices.length === 0 && (
        <div className="glass-card p-8 text-center">
          <div className="w-16 h-16 rounded-full bg-dark-700/50 flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-dark-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-white mb-2">Ingen fakturaer ennå</h3>
          <p className="text-dark-400">Fakturaer vil vises her etter første betaling.</p>
        </div>
      )}

      {/* Error State */}
      {!loading && error && (
        <div className="glass-card p-8 text-center border-red-500/30" role="alert" aria-live="assertive">
          <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-white mb-2">Kunne ikke laste fakturaer</h3>
          <p className="text-dark-400 mb-4">{error}</p>
          <button onClick={loadInvoices} className="btn-secondary">Prøv igjen</button>
        </div>
      )}

      {/* Invoices Table */}
      {!loading && !error && invoices.length > 0 && (
        <div className="glass-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-dark-700/50">
                  <th scope="col" className="text-left p-4 text-sm font-medium text-dark-300">Fakturanr.</th>
                  <th scope="col" className="text-left p-4 text-sm font-medium text-dark-300">Dato</th>
                  <th scope="col" className="text-left p-4 text-sm font-medium text-dark-300 hidden sm:table-cell">Periode</th>
                  <th scope="col" className="text-left p-4 text-sm font-medium text-dark-300">Beløp</th>
                  <th scope="col" className="text-left p-4 text-sm font-medium text-dark-300">Status</th>
                  <th scope="col" className="text-right p-4 text-sm font-medium text-dark-300">Handlinger</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map(invoice => {
                  const badge = getStatusBadge(invoice.status);
                  return (
                    <tr key={invoice.id} className="border-b border-dark-700/50 hover:bg-dark-800/30">
                      <td className="p-4">
                        <span className="text-white font-medium">{invoice.number || '-'}</span>
                      </td>
                      <td className="p-4 text-dark-300">{formatDate(invoice.created)}</td>
                      <td className="p-4 text-dark-300 hidden sm:table-cell">{formatPeriod(invoice.period_start, invoice.period_end)}</td>
                      <td className="p-4 text-white font-medium">{formatAmount(invoice.amount, invoice.currency)}</td>
                      <td className="p-4">
                        <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${badge.className}`}>
                          {badge.label}
                        </span>
                      </td>
                      <td className="p-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {invoice.hosted_invoice_url && (
                            <a
                              href={invoice.hosted_invoice_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="p-2 text-dark-400 hover:text-white hover:bg-dark-700/50 rounded-lg transition-colors"
                              title="Se faktura"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                              </svg>
                            </a>
                          )}
                          {invoice.invoice_pdf && (
                            <a
                              href={invoice.invoice_pdf}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="p-2 text-dark-400 hover:text-white hover:bg-dark-700/50 rounded-lg transition-colors"
                              title="Last ned PDF"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                              </svg>
                            </a>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
