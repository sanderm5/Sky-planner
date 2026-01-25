/**
 * Field Manager Service
 *
 * Handles business logic for dynamic organization fields and categories:
 * - Analyzing Excel data to suggest new fields/categories
 * - Managing field configurations
 * - Inferring field types from data
 */

// Known standard fields that should not be treated as custom
const STANDARD_FIELDS = new Set([
  'navn', 'name', 'kundenavn', 'kunde',
  'adresse', 'address', 'gateadresse',
  'postnummer', 'postnr', 'zip',
  'poststed', 'sted', 'by', 'city',
  'telefon', 'tlf', 'mobil', 'phone',
  'epost', 'email', 'e-post', 'mail',
  'kategori', 'category', 'tjeneste',
  'el_type', 'el-type', 'eltype',
  'brann_system', 'brannsystem', 'brann system',
  'brann_driftstype', 'driftstype', 'drift',
  'lat', 'latitude', 'breddegrad',
  'lng', 'lon', 'longitude', 'lengdegrad',
  'notater', 'notes', 'kommentar', 'merknad',
  'siste_kontroll', 'neste_kontroll', 'kontroll_intervall',
  'siste_el_kontroll', 'neste_el_kontroll', 'el_kontroll_intervall',
  'siste_brann_kontroll', 'neste_brann_kontroll', 'brann_kontroll_intervall'
]);

// Color palette for auto-assigned category colors
const CATEGORY_COLORS = [
  '#F59E0B', // amber
  '#10B981', // emerald
  '#3B82F6', // blue
  '#8B5CF6', // violet
  '#EC4899', // pink
  '#06B6D4', // cyan
  '#F97316', // orange
  '#84CC16', // lime
  '#6366F1', // indigo
  '#14B8A6'  // teal
];

// Icon suggestions based on common category names
const CATEGORY_ICONS = {
  'el': 'fa-bolt',
  'brann': 'fa-fire',
  'ventilasjon': 'fa-wind',
  'vvs': 'fa-faucet',
  'renhold': 'fa-broom',
  'vakt': 'fa-shield',
  'heis': 'fa-elevator',
  'sprinkler': 'fa-droplet',
  'alarm': 'fa-bell',
  'sikkerhet': 'fa-lock',
  'vedlikehold': 'fa-wrench',
  'service': 'fa-cog',
  'inspeksjon': 'fa-clipboard-check',
  'kontroll': 'fa-check-circle',
  'default': 'fa-tag'
};

/**
 * Analyzes Excel data to find new fields and categories
 *
 * @param {Array<Object>} rows - Parsed Excel rows
 * @param {Object} existingConfig - Existing organization configuration
 * @param {Array<Object>} existingConfig.fields - Existing custom fields
 * @param {Array<Object>} existingConfig.categories - Existing categories
 * @returns {Object} Analysis result with suggestions
 */
function analyzeExcelForDynamicSchema(rows, existingConfig = {}) {
  const { fields: existingFields = [], categories: existingCategories = [] } = existingConfig;

  if (!rows || rows.length === 0) {
    return {
      newCategories: [],
      newFields: [],
      newFieldValues: {},
      summary: { rowsAnalyzed: 0 }
    };
  }

  // Get all column headers from first row
  const headers = Object.keys(rows[0] || {});

  // Track unique values per column
  const columnValues = {};
  headers.forEach(h => columnValues[h] = new Set());

  // Collect all unique values
  for (const row of rows) {
    for (const header of headers) {
      const value = row[header];
      if (value !== null && value !== undefined && value !== '') {
        columnValues[header].add(String(value).trim());
      }
    }
  }

  // Find new categories
  const newCategories = findNewCategories(columnValues, existingCategories);

  // Find new custom fields
  const newFields = findNewFields(headers, columnValues, existingFields);

  // Find new values for existing select fields
  const newFieldValues = findNewFieldValues(columnValues, existingFields);

  return {
    newCategories,
    newFields,
    newFieldValues,
    summary: {
      rowsAnalyzed: rows.length,
      columnsAnalyzed: headers.length,
      newCategoriesFound: newCategories.length,
      newFieldsFound: newFields.length,
      fieldsWithNewValues: Object.keys(newFieldValues).length
    }
  };
}

/**
 * Finds new categories from the kategori column
 */
function findNewCategories(columnValues, existingCategories) {
  const categoryColumn = findColumn(columnValues, ['kategori', 'category', 'tjeneste']);
  if (!categoryColumn) return [];

  const existingNames = new Set(existingCategories.map(c => c.name.toLowerCase()));
  const existingSlugs = new Set(existingCategories.map(c => c.slug));

  const newCategories = [];
  let colorIndex = existingCategories.length;

  for (const value of columnValues[categoryColumn]) {
    const normalizedName = value.trim();
    const slug = generateSlug(normalizedName);

    // Skip if category already exists
    if (existingNames.has(normalizedName.toLowerCase()) || existingSlugs.has(slug)) {
      continue;
    }

    // Skip combined categories (e.g., "El-Kontroll + Brannvarsling")
    if (normalizedName.includes('+') || normalizedName.includes(' og ')) {
      // Could be a combined category, suggest the parts instead
      const parts = normalizedName.split(/\s*[\+,]\s*|\s+og\s+/i);
      for (const part of parts) {
        const partName = part.trim();
        const partSlug = generateSlug(partName);
        if (partName && !existingNames.has(partName.toLowerCase()) && !existingSlugs.has(partSlug)) {
          if (!newCategories.find(c => c.slug === partSlug)) {
            newCategories.push(createCategorySuggestion(partName, colorIndex++));
            existingNames.add(partName.toLowerCase());
          }
        }
      }
    } else {
      newCategories.push(createCategorySuggestion(normalizedName, colorIndex++));
      existingNames.add(normalizedName.toLowerCase());
    }
  }

  return newCategories;
}

/**
 * Creates a category suggestion with auto-assigned icon and color
 */
function createCategorySuggestion(name, colorIndex) {
  const slug = generateSlug(name);
  const nameLower = name.toLowerCase();

  // Find matching icon
  let icon = CATEGORY_ICONS.default;
  for (const [keyword, iconClass] of Object.entries(CATEGORY_ICONS)) {
    if (nameLower.includes(keyword)) {
      icon = iconClass;
      break;
    }
  }

  return {
    name,
    slug,
    icon,
    color: CATEGORY_COLORS[colorIndex % CATEGORY_COLORS.length],
    default_interval_months: 12,
    suggested: true
  };
}

/**
 * Finds new custom fields from column headers
 */
function findNewFields(headers, columnValues, existingFields) {
  const existingFieldNames = new Set(existingFields.map(f => f.field_name));
  const newFields = [];

  for (const header of headers) {
    const normalizedHeader = header.toLowerCase().replace(/[^a-z0-9æøå_]/g, '_');

    // Skip standard fields
    if (STANDARD_FIELDS.has(normalizedHeader) || STANDARD_FIELDS.has(header.toLowerCase())) {
      continue;
    }

    // Skip if field already exists
    if (existingFieldNames.has(normalizedHeader)) {
      continue;
    }

    // Analyze values to suggest field type
    const values = Array.from(columnValues[header] || []);
    const fieldType = inferFieldType(values);

    const field = {
      field_name: normalizedHeader,
      display_name: capitalizeFirstLetter(header),
      field_type: fieldType.type,
      is_filterable: fieldType.type === 'select' && fieldType.uniqueValues.length <= 20,
      is_visible: true,
      suggested: true
    };

    // If it's a select type, include the unique values as options
    if (fieldType.type === 'select') {
      field.options = fieldType.uniqueValues.map(v => ({
        value: v,
        display_name: v
      }));
    }

    newFields.push(field);
  }

  return newFields;
}

/**
 * Finds new values for existing select fields
 */
function findNewFieldValues(columnValues, existingFields) {
  const newFieldValues = {};

  for (const field of existingFields) {
    if (field.field_type !== 'select') continue;

    // Find matching column
    const column = findColumn(columnValues, [field.field_name, field.display_name]);
    if (!column) continue;

    const existingOptions = new Set(
      (field.options || []).map(o => o.value.toLowerCase())
    );

    const newValues = [];
    for (const value of columnValues[column]) {
      if (!existingOptions.has(value.toLowerCase())) {
        newValues.push(value);
      }
    }

    if (newValues.length > 0) {
      newFieldValues[field.field_name] = newValues;
    }
  }

  return newFieldValues;
}

/**
 * Infers the field type from sample values
 */
function inferFieldType(values) {
  if (values.length === 0) {
    return { type: 'text', uniqueValues: [] };
  }

  const uniqueValues = [...new Set(values)];
  const sampleSize = Math.min(values.length, 100);

  // Check if all values are dates
  const dateCount = values.slice(0, sampleSize).filter(isDateValue).length;
  if (dateCount / sampleSize > 0.8) {
    return { type: 'date', uniqueValues };
  }

  // Check if all values are numbers
  const numberCount = values.slice(0, sampleSize).filter(isNumberValue).length;
  if (numberCount / sampleSize > 0.8) {
    return { type: 'number', uniqueValues };
  }

  // If few unique values relative to total, suggest select
  const uniqueRatio = uniqueValues.length / values.length;
  if (uniqueValues.length <= 20 && (uniqueRatio < 0.3 || uniqueValues.length <= 5)) {
    return { type: 'select', uniqueValues: uniqueValues.sort() };
  }

  // Default to text
  return { type: 'text', uniqueValues };
}

/**
 * Checks if a value looks like a date
 */
function isDateValue(value) {
  if (!value) return false;
  const str = String(value);

  // ISO date
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return true;

  // Norwegian date format
  if (/^\d{1,2}\.\d{1,2}\.\d{2,4}$/.test(str)) return true;

  // Slash format
  if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(str)) return true;

  // Excel serial number (dates from 1900-2100 roughly)
  if (/^\d{5}$/.test(str)) {
    const num = parseInt(str, 10);
    return num >= 1 && num <= 73050; // ~2100
  }

  return false;
}

/**
 * Checks if a value looks like a number
 */
function isNumberValue(value) {
  if (!value) return false;
  const str = String(value).replace(/\s/g, '').replace(',', '.');
  return !isNaN(parseFloat(str)) && isFinite(str);
}

/**
 * Finds a column by checking multiple possible names
 */
function findColumn(columnValues, possibleNames) {
  for (const name of possibleNames) {
    const lower = name.toLowerCase();
    for (const col of Object.keys(columnValues)) {
      if (col.toLowerCase() === lower) {
        return col;
      }
    }
  }
  return null;
}

/**
 * Generates a URL-safe slug from a name
 */
function generateSlug(name) {
  return name.toLowerCase()
    .replace(/æ/g, 'ae')
    .replace(/ø/g, 'o')
    .replace(/å/g, 'a')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Capitalizes the first letter of a string
 */
function capitalizeFirstLetter(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Merges customer data with custom fields for storage
 *
 * @param {Object} customerData - Raw customer data from form/import
 * @param {Array<Object>} fields - Organization's custom fields
 * @returns {Object} Processed data with custom_data JSON
 */
function processCustomerCustomData(customerData, fields) {
  const customData = {};
  const standardData = { ...customerData };

  for (const field of fields) {
    const fieldName = field.field_name;
    if (customerData.hasOwnProperty(fieldName)) {
      customData[fieldName] = customerData[fieldName];
      delete standardData[fieldName];
    }
  }

  return {
    ...standardData,
    custom_data: JSON.stringify(customData)
  };
}

/**
 * Extracts custom fields from a customer record
 *
 * @param {Object} customer - Customer record from database
 * @returns {Object} Customer with parsed custom_data fields
 */
function expandCustomerCustomData(customer) {
  if (!customer) return customer;

  let customData = {};
  try {
    customData = JSON.parse(customer.custom_data || '{}');
  } catch (e) {
    customData = {};
  }

  return {
    ...customer,
    ...customData,
    custom_data: undefined // Remove the JSON string from response
  };
}

module.exports = {
  analyzeExcelForDynamicSchema,
  processCustomerCustomData,
  expandCustomerCustomData,
  generateSlug,
  inferFieldType,
  STANDARD_FIELDS,
  CATEGORY_COLORS,
  CATEGORY_ICONS
};
