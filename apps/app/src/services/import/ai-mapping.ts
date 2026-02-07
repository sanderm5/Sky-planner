/**
 * AI-Assisted Column Mapping
 * Uses Claude API to suggest mappings for columns that regex patterns can't match
 */

import { getConfig } from '../../config/env';
import { apiLogger } from '../logger';

/** Target fields available for mapping */
const TARGET_FIELDS = [
  { field: 'navn', description: 'Kundenavn / firmanavn', type: 'string' },
  { field: 'adresse', description: 'Gateadresse', type: 'string' },
  { field: 'postnummer', description: 'Norsk postnummer (4 siffer)', type: 'postnummer' },
  { field: 'poststed', description: 'Poststed / by', type: 'string' },
  { field: 'telefon', description: 'Telefonnummer', type: 'phone' },
  { field: 'epost', description: 'E-postadresse', type: 'email' },
  { field: 'kontaktperson', description: 'Kontaktperson', type: 'string' },
  { field: 'kategori', description: 'Kundekategori / bransje', type: 'string' },
  { field: 'notater', description: 'Notater / kommentarer', type: 'string' },
  { field: 'siste_el_kontroll', description: 'Dato for siste el-kontroll', type: 'date' },
  { field: 'neste_el_kontroll', description: 'Dato for neste el-kontroll', type: 'date' },
  { field: 'siste_brann_kontroll', description: 'Dato for siste brannkontroll', type: 'date' },
  { field: 'neste_brann_kontroll', description: 'Dato for neste brannkontroll', type: 'date' },
  { field: 'siste_kontroll', description: 'Dato for siste generelle kontroll', type: 'date' },
  { field: 'neste_kontroll', description: 'Dato for neste generelle kontroll', type: 'date' },
  { field: 'el_type', description: 'Anleggstype (Landbruk/Næring/Bolig/Gartneri)', type: 'string' },
  { field: 'brann_system', description: 'Brannvarslingssystem (Elotec/ICAS)', type: 'string' },
  { field: 'kontroll_intervall_mnd', description: 'Kontrollintervall i måneder', type: 'integer' },
  { field: 'org_nummer', description: 'Organisasjonsnummer', type: 'string' },
  { field: 'ekstern_id', description: 'Eksternt kunde-ID / kundenummer', type: 'string' },
] as const;

interface AIMappingSuggestion {
  sourceColumn: string;
  targetField: string;
  confidence: number;
  reasoning: string;
}

interface AIResponse {
  mappings: AIMappingSuggestion[];
}

/**
 * Call Claude API to suggest mappings for unmapped columns
 */
export async function getAIMappingSuggestions(
  unmappedHeaders: string[],
  sampleRows: Record<string, unknown>[],
  alreadyMapped: Record<string, string>
): Promise<AIMappingSuggestion[]> {
  const config = getConfig();

  const apiKey = config.AI_API_KEY;
  if (!config.AI_IMPORT_ENABLED || !apiKey) {
    return [];
  }

  if (unmappedHeaders.length === 0) {
    return [];
  }

  // Build sample data for each unmapped column (max 3 rows)
  const sampleData: Record<string, string[]> = {};
  for (const header of unmappedHeaders) {
    sampleData[header] = sampleRows
      .slice(0, 3)
      .map(row => {
        const val = row[header];
        if (typeof val === 'string') return val;
        if (typeof val === 'number') return String(val);
        return '';
      })
      .filter(v => v.trim() !== '');
  }

  // Filter out already-mapped target fields
  const availableTargets = TARGET_FIELDS.filter(
    t => !Object.values(alreadyMapped).includes(t.field)
  );

  if (availableTargets.length === 0) {
    return [];
  }

  const prompt = buildPrompt(unmappedHeaders, sampleData, availableTargets, alreadyMapped);

  try {
    const model = config.AI_MODEL || 'claude-3-5-haiku-latest';
    const timeout = config.AI_TIMEOUT_MS || 10000;
    return await callClaudeAPI(apiKey, model, prompt, timeout);
  } catch (err) {
    apiLogger.warn({ err }, 'AI mapping suggestion failed, falling back to manual mapping');
    return [];
  }
}

function buildPrompt(
  unmappedHeaders: string[],
  sampleData: Record<string, string[]>,
  availableTargets: typeof TARGET_FIELDS[number][],
  alreadyMapped: Record<string, string>
): string {
  const targetList = availableTargets
    .map(t => `  - "${t.field}": ${t.description} (${t.type})`)
    .join('\n');

  const alreadyMappedStr = Object.entries(alreadyMapped)
    .map(([src, tgt]) => `  "${src}" → "${tgt}"`)
    .join('\n');

  const columnsToMap = unmappedHeaders
    .map(h => {
      const samples = sampleData[h] || [];
      const sampleStr = samples.length > 0
        ? `Eksempler: ${samples.map(s => `"${s}"`).join(', ')}`
        : 'Ingen eksempler';
      return `  - "${h}": ${sampleStr}`;
    })
    .join('\n');

  return `Du er en ekspert på norsk kundedata-import. Analyser følgende Excel-kolonner og foreslå hvilke databasefelt de tilhører.

Allerede mappede kolonner:
${alreadyMappedStr || '  (ingen)'}

Kolonner som trenger mapping:
${columnsToMap}

Tilgjengelige målfelt:
${targetList}

Svar BARE med gyldig JSON i dette formatet (ingen annen tekst):
{
  "mappings": [
    {
      "sourceColumn": "kolonnenavn",
      "targetField": "feltnavnet",
      "confidence": 0.85,
      "reasoning": "kort begrunnelse"
    }
  ]
}

Regler:
- confidence skal være mellom 0.0 og 1.0
- Hvis du er usikker (< 0.5), IKKE inkluder den kolonnen
- Hver targetField kan bare brukes én gang
- Basert på kolonnenavnet OG eksempeldata, velg best match
- Svar KUN med JSON, ingen annen tekst`;
}

async function callClaudeAPI(
  apiKey: string,
  model: string,
  prompt: string,
  timeoutMs: number
): Promise<AIMappingSuggestion[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Claude API error ${response.status}: ${errorText}`);
    }

    const data = await response.json() as {
      content: Array<{ type: string; text?: string }>;
    };

    const textContent = data.content.find(c => c.type === 'text');
    if (!textContent?.text) {
      throw new Error('No text content in Claude response');
    }

    return parseAIResponse(textContent.text);
  } finally {
    clearTimeout(timer);
  }
}

function parseAIResponse(responseText: string): AIMappingSuggestion[] {
  // Extract JSON from response (may have markdown fences)
  let jsonStr = responseText.trim();
  const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    jsonStr = fenceMatch[1].trim();
  }

  const parsed: AIResponse = JSON.parse(jsonStr);

  if (!parsed.mappings || !Array.isArray(parsed.mappings)) {
    return [];
  }

  // Validate and filter results
  const validFields = new Set<string>(TARGET_FIELDS.map(t => t.field));
  const usedTargets = new Set<string>();

  return parsed.mappings
    .filter(m => {
      if (!m.sourceColumn || !m.targetField || typeof m.confidence !== 'number') {
        return false;
      }
      if (!validFields.has(m.targetField)) return false;
      if (m.confidence < 0.5) return false;
      if (usedTargets.has(m.targetField)) return false;
      usedTargets.add(m.targetField);
      return true;
    })
    .map(m => ({
      sourceColumn: m.sourceColumn,
      targetField: m.targetField,
      confidence: Math.min(1, Math.max(0, m.confidence)),
      reasoning: m.reasoning || '',
    }));
}
