import { describe, it, expect } from 'vitest';
import { validatePassword, assertValidPassword, getPasswordStrengthLabel } from '../../../../packages/auth/src/password-validation';

describe('Password Validation', () => {
  describe('validatePassword', () => {
    it('should reject passwords shorter than minimum length', () => {
      const result = validatePassword('Short1!');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Passordet må være minst 10 tegn');
    });

    it('should reject passwords without uppercase', () => {
      const result = validatePassword('lowercase123!@');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Passordet må inneholde minst én stor bokstav');
    });

    it('should reject passwords without lowercase', () => {
      const result = validatePassword('UPPERCASE123!@');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Passordet må inneholde minst én liten bokstav');
    });

    it('should reject passwords without numbers', () => {
      const result = validatePassword('NoNumbersHere!@');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Passordet må inneholde minst ett tall');
    });

    it('should reject passwords without special characters', () => {
      const result = validatePassword('NoSpecial123AB');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Passordet må inneholde minst ett spesialtegn (!@#$%^&*...)');
    });

    it('should reject common passwords', () => {
      const result = validatePassword('password');
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('vanlig'))).toBe(true);
    });

    it('should reject Norwegian common passwords', () => {
      const result = validatePassword('passord');
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('vanlig'))).toBe(true);
    });

    it('should accept a strong password', () => {
      const result = validatePassword('MyS3cur3P@ss!x');
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(['good', 'strong']).toContain(result.strength);
    });

    it('should detect similarity to email', () => {
      const result = validatePassword('JohnDoe123!@a', {
        userContext: { email: 'johndoe@example.com' },
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('e-postadressen'))).toBe(true);
    });

    it('should detect keyboard patterns', () => {
      const result = validatePassword('Qwerty12345!a');
      expect(result.errors.some(e => e.includes('mønstre'))).toBe(true);
    });

    it('should give higher score for longer passwords', () => {
      const short = validatePassword('Aa1!xxxxxx'); // 10 chars
      const long = validatePassword('Aa1!xxxxxxxxxxxxxx'); // 18 chars
      expect(long.score).toBeGreaterThan(short.score);
    });
  });

  describe('assertValidPassword', () => {
    it('should not throw for valid passwords', () => {
      expect(() => assertValidPassword('MyS3cur3P@ss!x')).not.toThrow();
    });

    it('should throw with first error for invalid passwords', () => {
      expect(() => assertValidPassword('short')).toThrow();
    });
  });

  describe('getPasswordStrengthLabel', () => {
    it('should return Norwegian labels', () => {
      expect(getPasswordStrengthLabel('weak')).toBe('Svakt');
      expect(getPasswordStrengthLabel('fair')).toBe('Middels');
      expect(getPasswordStrengthLabel('good')).toBe('Bra');
      expect(getPasswordStrengthLabel('strong')).toBe('Sterkt');
    });
  });
});
