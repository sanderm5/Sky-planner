/**
 * Input validation utilities
 */

import type { ValidationError, CreateKundeRequest } from '../types/index.js';

// Email regex pattern
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Date format YYYY-MM-DD
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

// Phone number - at least 8 digits
const PHONE_REGEX = /\d.*\d.*\d.*\d.*\d.*\d.*\d.*\d/;

/**
 * Validates a kunde (customer) object
 */
export function validateKunde(kunde: CreateKundeRequest): ValidationError[] | null {
  const errors: ValidationError[] = [];

  // Required fields
  if (!kunde.navn || kunde.navn.trim().length < 2) {
    errors.push({
      field: 'navn',
      message: 'Navn må være minst 2 tegn',
    });
  }

  if (!kunde.adresse || kunde.adresse.trim().length < 3) {
    errors.push({
      field: 'adresse',
      message: 'Adresse må være minst 3 tegn',
    });
  }

  // Optional field validation
  if (kunde.epost && !EMAIL_REGEX.test(kunde.epost)) {
    errors.push({
      field: 'epost',
      message: 'Ugyldig e-postformat',
    });
  }

  if (kunde.telefon && !PHONE_REGEX.test(kunde.telefon)) {
    errors.push({
      field: 'telefon',
      message: 'Telefonnummer må inneholde minst 8 siffer',
    });
  }

  if (kunde.postnummer && !/^\d{4}$/.test(kunde.postnummer)) {
    errors.push({
      field: 'postnummer',
      message: 'Postnummer må være 4 siffer',
    });
  }

  // Coordinates validation
  if (kunde.lat !== undefined && (kunde.lat < -90 || kunde.lat > 90)) {
    errors.push({
      field: 'lat',
      message: 'Breddegrad må være mellom -90 og 90',
    });
  }

  if (kunde.lng !== undefined && (kunde.lng < -180 || kunde.lng > 180)) {
    errors.push({
      field: 'lng',
      message: 'Lengdegrad må være mellom -180 og 180',
    });
  }

  // Interval validation
  const validElIntervals = [12, 24, 36, 60];
  if (
    kunde.el_kontroll_intervall !== undefined &&
    !validElIntervals.includes(kunde.el_kontroll_intervall)
  ) {
    errors.push({
      field: 'el_kontroll_intervall',
      message: 'El-kontroll intervall må være 12, 24, 36, eller 60 måneder',
    });
  }

  // Category validation
  const validCategories = ['El-Kontroll', 'Brannvarsling', 'El-Kontroll + Brannvarsling'];
  if (kunde.kategori && !validCategories.includes(kunde.kategori)) {
    errors.push({
      field: 'kategori',
      message: 'Ugyldig kategori',
    });
  }

  return errors.length > 0 ? errors : null;
}

/**
 * Validates a date string in YYYY-MM-DD format
 */
export function validateDate(dateStr: string, fieldName: string): ValidationError | null {
  if (!DATE_REGEX.test(dateStr)) {
    return {
      field: fieldName,
      message: `${fieldName} må være i format YYYY-MM-DD`,
    };
  }

  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) {
    return {
      field: fieldName,
      message: `Ugyldig dato for ${fieldName}`,
    };
  }

  return null;
}

/**
 * Validates login request
 */
export function validateLoginRequest(
  epost: string,
  passord: string
): ValidationError[] | null {
  const errors: ValidationError[] = [];

  if (!epost || !EMAIL_REGEX.test(epost)) {
    errors.push({
      field: 'epost',
      message: 'Ugyldig e-postformat',
    });
  }

  if (!passord || passord.length < 8) {
    errors.push({
      field: 'passord',
      message: 'Passord må være minst 8 tegn',
    });
  }

  return errors.length > 0 ? errors : null;
}

/**
 * Password strength requirements for new passwords
 */
export interface PasswordStrengthResult {
  valid: boolean;
  errors: string[];
  score: number; // 0-4
}

/**
 * Validates password strength for registration/password change
 * Requirements:
 * - Minimum 8 characters
 * - At least one uppercase letter
 * - At least one lowercase letter
 * - At least one number
 */
export function validatePasswordStrength(password: string): PasswordStrengthResult {
  const errors: string[] = [];
  let score = 0;

  if (!password) {
    return { valid: false, errors: ['Passord er påkrevd'], score: 0 };
  }

  // Minimum length
  if (password.length < 8) {
    errors.push('Passord må være minst 8 tegn');
  } else {
    score++;
    if (password.length >= 12) score++;
  }

  // Uppercase letter
  if (!/[A-ZÆØÅ]/.test(password)) {
    errors.push('Passord må inneholde minst én stor bokstav');
  } else {
    score++;
  }

  // Lowercase letter
  if (!/[a-zæøå]/.test(password)) {
    errors.push('Passord må inneholde minst én liten bokstav');
  } else {
    score++;
  }

  // Number
  if (!/\d/.test(password)) {
    errors.push('Passord må inneholde minst ett tall');
  } else {
    score++;
  }

  return {
    valid: errors.length === 0,
    errors,
    score: Math.min(4, score),
  };
}

/**
 * Validates search input to prevent injection
 */
export function validateSearchInput(search: string): string | null {
  if (!search || typeof search !== 'string') {
    return null;
  }

  // Max length
  if (search.length > 100) {
    return null;
  }

  // Remove dangerous characters, keep only safe ones
  const sanitized = search
    .replace(/[<>'"`;\\]/g, '')
    .trim();

  return sanitized.length > 0 ? sanitized : null;
}

/**
 * Sanitizes a string to prevent XSS
 */
export function sanitizeString(input: string): string {
  if (typeof input !== 'string') {
    return '';
  }
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/**
 * Sanitizes an object's string properties
 */
export function sanitizeObject<T extends Record<string, unknown>>(obj: T): T {
  const sanitized = { ...obj };
  for (const key of Object.keys(sanitized)) {
    const value = sanitized[key];
    if (typeof value === 'string') {
      (sanitized as Record<string, unknown>)[key] = sanitizeString(value);
    }
  }
  return sanitized;
}
