import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateCsrfToken, ensureCsrfToken, CSRF_COOKIE_NAME, CSRF_HEADER_NAME, csrfProtection } from '../../../src/middleware/csrf';
import type { Request, Response, NextFunction } from 'express';

describe('CSRF Protection', () => {
  describe('generateCsrfToken', () => {
    it('should generate a 64-character hex token', () => {
      const token = generateCsrfToken();
      expect(token).toHaveLength(64);
      expect(token).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should generate unique tokens', () => {
      const tokens = new Set(Array.from({ length: 10 }, () => generateCsrfToken()));
      expect(tokens.size).toBe(10);
    });
  });

  describe('ensureCsrfToken', () => {
    let mockReq: Partial<Request>;
    let mockRes: Partial<Response>;

    beforeEach(() => {
      mockReq = { cookies: {} };
      mockRes = { cookie: vi.fn() };
    });

    it('should generate and set a new token if none exists', () => {
      const token = ensureCsrfToken(mockReq as Request, mockRes as Response);

      expect(token).toHaveLength(64);
      expect(mockRes.cookie).toHaveBeenCalledWith(
        CSRF_COOKIE_NAME,
        token,
        expect.objectContaining({
          httpOnly: false,
          sameSite: 'strict',
          path: '/',
        })
      );
    });

    it('should reuse existing valid token from cookie', () => {
      const existingToken = 'a'.repeat(64);
      mockReq.cookies = { [CSRF_COOKIE_NAME]: existingToken };

      const token = ensureCsrfToken(mockReq as Request, mockRes as Response);

      expect(token).toBe(existingToken);
      expect(mockRes.cookie).not.toHaveBeenCalled();
    });

    it('should generate new token if existing one has wrong length', () => {
      mockReq.cookies = { [CSRF_COOKIE_NAME]: 'tooshort' };

      const token = ensureCsrfToken(mockReq as Request, mockRes as Response);

      expect(token).toHaveLength(64);
      expect(mockRes.cookie).toHaveBeenCalled();
    });
  });

  describe('csrfProtection middleware', () => {
    let mockRes: Partial<Response>;
    let mockNext: NextFunction;
    let jsonFn: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      jsonFn = vi.fn();
      mockRes = {
        status: vi.fn().mockReturnValue({ json: jsonFn }),
      };
      mockNext = vi.fn();
    });

    const middleware = csrfProtection();

    it('should allow safe methods (GET)', () => {
      const req = { method: 'GET', path: '/api/kunder', cookies: {}, headers: {} } as unknown as Request;

      middleware(req, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should allow requests with API key', () => {
      const req = {
        method: 'POST',
        path: '/api/kunder',
        cookies: {},
        headers: { 'x-api-key': 'sk_test_123' },
      } as unknown as Request;

      middleware(req, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should allow exempt paths', () => {
      const req = {
        method: 'POST',
        path: '/api/v1/customers',
        cookies: {},
        headers: {},
      } as unknown as Request;

      middleware(req, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should reject POST without CSRF token', () => {
      const req = {
        method: 'POST',
        path: '/api/kunder',
        cookies: {},
        headers: {},
        ip: '127.0.0.1',
      } as unknown as Request;

      middleware(req, mockRes as Response, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(jsonFn).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({ code: 'CSRF_VALIDATION_FAILED' }),
        })
      );
    });

    it('should reject mismatched tokens', () => {
      const token1 = 'a'.repeat(64);
      const token2 = 'b'.repeat(64);
      const req = {
        method: 'POST',
        path: '/api/kunder',
        cookies: { [CSRF_COOKIE_NAME]: token1 },
        headers: { [CSRF_HEADER_NAME]: token2 },
        ip: '127.0.0.1',
      } as unknown as Request;

      middleware(req, mockRes as Response, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(403);
    });

    it('should allow matching tokens', () => {
      const token = generateCsrfToken();
      const req = {
        method: 'POST',
        path: '/api/kunder',
        cookies: { [CSRF_COOKIE_NAME]: token },
        headers: { [CSRF_HEADER_NAME]: token },
      } as unknown as Request;

      middleware(req, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });
  });
});
