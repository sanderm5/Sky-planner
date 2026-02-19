/**
 * Data Export Service
 * Exports organization data in various formats
 */

import ExcelJS from 'exceljs';
import { createLogger } from './logger';

const logger = createLogger('export');

// ============ Types ============

export interface ExportOptions {
  format: 'csv' | 'json';
  includeHeaders?: boolean;
}

export interface ExportResult {
  data: string | Buffer;
  filename: string;
  contentType: string;
}

// ============ CSV Utilities ============

/**
 * Escape a value for CSV format
 */
function escapeCSVValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  const str = String(value);

  // If contains comma, newline, or quote, wrap in quotes and escape quotes
  if (str.includes(',') || str.includes('\n') || str.includes('"') || str.includes(';')) {
    return `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

/**
 * Convert array of objects to CSV string
 */
export function toCSV<T>(
  data: T[],
  columns: { key: keyof T; label: string }[],
  options: { includeHeaders?: boolean; delimiter?: string } = {}
): string {
  const { includeHeaders = true, delimiter = ';' } = options;

  const lines: string[] = [];

  // Add header row
  if (includeHeaders) {
    lines.push(columns.map((col) => escapeCSVValue(col.label)).join(delimiter));
  }

  // Add data rows
  for (const row of data) {
    const values = columns.map((col) => escapeCSVValue(row[col.key]));
    lines.push(values.join(delimiter));
  }

  return lines.join('\n');
}

// ============ Customer Export ============

export interface CustomerExportRow {
  id: number;
  navn: string;
  adresse: string;
  postnummer?: string;
  poststed?: string;
  telefon?: string;
  epost?: string;
  kategori?: string;
  siste_el_kontroll?: string;
  neste_el_kontroll?: string;
  siste_brann_kontroll?: string;
  neste_brann_kontroll?: string;
  notater?: string;
  opprettet?: string;
}

const CUSTOMER_COLUMNS: { key: keyof CustomerExportRow; label: string }[] = [
  { key: 'id', label: 'ID' },
  { key: 'navn', label: 'Navn' },
  { key: 'adresse', label: 'Adresse' },
  { key: 'postnummer', label: 'Postnummer' },
  { key: 'poststed', label: 'Poststed' },
  { key: 'telefon', label: 'Telefon' },
  { key: 'epost', label: 'E-post' },
  { key: 'kategori', label: 'Kategori' },
  { key: 'siste_el_kontroll', label: 'Siste el-kontroll' },
  { key: 'neste_el_kontroll', label: 'Neste el-kontroll' },
  { key: 'siste_brann_kontroll', label: 'Siste brann-kontroll' },
  { key: 'neste_brann_kontroll', label: 'Neste brann-kontroll' },
  { key: 'notater', label: 'Notater' },
  { key: 'opprettet', label: 'Opprettet' },
];

export function exportCustomersToCSV(customers: CustomerExportRow[]): ExportResult {
  const csv = toCSV(customers, CUSTOMER_COLUMNS);
  const timestamp = new Date().toISOString().split('T')[0];

  return {
    data: csv,
    filename: `kunder_${timestamp}.csv`,
    contentType: 'text/csv; charset=utf-8',
  };
}

export function exportCustomersToJSON(customers: CustomerExportRow[]): ExportResult {
  const timestamp = new Date().toISOString().split('T')[0];

  return {
    data: JSON.stringify(customers, null, 2),
    filename: `kunder_${timestamp}.json`,
    contentType: 'application/json; charset=utf-8',
  };
}

export async function exportCustomersToXLSX(customers: CustomerExportRow[]): Promise<ExportResult> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Kunder');

  worksheet.columns = CUSTOMER_COLUMNS.map((col) => ({
    header: col.label,
    key: col.key,
  }));

  for (const c of customers) {
    worksheet.addRow(c);
  }

  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const timestamp = new Date().toISOString().split('T')[0];

  return {
    data: buffer,
    filename: `kunder_${timestamp}.xlsx`,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
}

// ============ vCard Export ============

function vcfEscape(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

export function exportCustomersToVCF(customers: CustomerExportRow[]): ExportResult {
  const vcards = customers.map((c) => {
    const lines = ['BEGIN:VCARD', 'VERSION:3.0', `FN:${vcfEscape(c.navn)}`];
    if (c.telefon) lines.push(`TEL;TYPE=WORK:${c.telefon.replace(/\s/g, '')}`);
    if (c.epost) lines.push(`EMAIL;TYPE=WORK:${vcfEscape(c.epost)}`);
    if (c.adresse) {
      lines.push(
        `ADR;TYPE=WORK:;;${vcfEscape(c.adresse)};${vcfEscape(c.poststed || '')};;${vcfEscape(c.postnummer || '')};Norge`
      );
    }
    if (c.kategori) lines.push(`CATEGORIES:${vcfEscape(c.kategori)}`);
    lines.push('END:VCARD');
    return lines.join('\r\n');
  });

  const timestamp = new Date().toISOString().split('T')[0];
  return {
    data: vcards.join('\r\n'),
    filename: `kunder_${timestamp}.vcf`,
    contentType: 'text/vcard; charset=utf-8',
  };
}

// ============ Routes Export ============

export interface RouteExportRow {
  id: number;
  navn: string;
  beskrivelse?: string;
  antall_kunder: number;
  opprettet?: string;
}

const ROUTE_COLUMNS: { key: keyof RouteExportRow; label: string }[] = [
  { key: 'id', label: 'ID' },
  { key: 'navn', label: 'Navn' },
  { key: 'beskrivelse', label: 'Beskrivelse' },
  { key: 'antall_kunder', label: 'Antall kunder' },
  { key: 'opprettet', label: 'Opprettet' },
];

export function exportRoutesToCSV(routes: RouteExportRow[]): ExportResult {
  const csv = toCSV(routes, ROUTE_COLUMNS);
  const timestamp = new Date().toISOString().split('T')[0];

  return {
    data: csv,
    filename: `ruter_${timestamp}.csv`,
    contentType: 'text/csv; charset=utf-8',
  };
}

export function exportRoutesToJSON(routes: RouteExportRow[]): ExportResult {
  const timestamp = new Date().toISOString().split('T')[0];

  return {
    data: JSON.stringify(routes, null, 2),
    filename: `ruter_${timestamp}.json`,
    contentType: 'application/json; charset=utf-8',
  };
}

export async function exportRoutesToXLSX(routes: RouteExportRow[]): Promise<ExportResult> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Ruter');

  worksheet.columns = ROUTE_COLUMNS.map((col) => ({
    header: col.label,
    key: col.key,
  }));

  for (const r of routes) {
    worksheet.addRow(r);
  }

  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const timestamp = new Date().toISOString().split('T')[0];

  return {
    data: buffer,
    filename: `ruter_${timestamp}.xlsx`,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
}

// ============ GDPR Full Export ============

export interface GDPRExportData {
  organization: {
    id: number;
    navn: string;
    slug: string;
    plan_type: string;
    opprettet?: string;
  };
  user: {
    id: number;
    navn: string;
    epost: string;
    opprettet?: string;
  };
  customers: CustomerExportRow[];
  routes: RouteExportRow[];
  exportedAt: string;
}

export function exportGDPRData(data: GDPRExportData): ExportResult {
  const timestamp = new Date().toISOString().split('T')[0];

  logger.info(
    {
      organizationId: data.organization.id,
      customerCount: data.customers.length,
      routeCount: data.routes.length,
    },
    'GDPR data export generated'
  );

  return {
    data: JSON.stringify(data, null, 2),
    filename: `skyplanner_data_export_${timestamp}.json`,
    contentType: 'application/json; charset=utf-8',
  };
}
