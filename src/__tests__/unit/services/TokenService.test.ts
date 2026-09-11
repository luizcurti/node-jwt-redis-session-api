import { sign } from 'jsonwebtoken';
import { UnauthorizedError } from '../../../errors/AppError';
import { TokenService } from '../../../services/TokenService';

describe('TokenService', () => {
  const originalSecret = process.env.JWT_SECRET;
  let tokenService: TokenService;

  const validSecret = 'unit-test-secret-that-is-at-least-32-chars-long';

  beforeEach(() => {
    process.env.JWT_SECRET = validSecret;
    tokenService = new TokenService();
  });

  afterEach(() => {
    process.env.JWT_SECRET = originalSecret;
  });

  describe('signAccessToken / verifyAccessToken', () => {
    it('signs a token whose subject, session, and role can be recovered', () => {
      const token = tokenService.signAccessToken('user-1', 'session-1', 'user');

      expect(tokenService.verifyAccessToken(token)).toEqual({
        subject: 'user-1',
        sessionId: 'session-1',
        role: 'user',
      });
    });

    it('throws when JWT_SECRET is not set', () => {
      delete process.env.JWT_SECRET;

      expect(() =>
        tokenService.signAccessToken('user-1', 'session-1', 'user')
      ).toThrow('JWT_SECRET environment variable is not set');
    });

    it('throws when JWT_SECRET is shorter than 32 characters', () => {
      process.env.JWT_SECRET = 'too-short';

      expect(() =>
        tokenService.signAccessToken('user-1', 'session-1', 'user')
      ).toThrow('JWT_SECRET must be at least 32 characters long');
    });

    it('throws UnauthorizedError for a malformed token', () => {
      expect(() => tokenService.verifyAccessToken('not-a-real-token')).toThrow(
        UnauthorizedError
      );
    });

    it('throws UnauthorizedError for a token signed with a different secret', () => {
      const token = tokenService.signAccessToken('user-1', 'session-1', 'user');
      process.env.JWT_SECRET = 'a-different-secret-that-is-at-least-32-chars';

      expect(() => tokenService.verifyAccessToken(token)).toThrow(
        UnauthorizedError
      );
    });

    it('throws UnauthorizedError for a token with the wrong issuer', () => {
      const token = sign({ sid: 'session-1' }, validSecret, {
        subject: 'user-1',
        issuer: 'some-other-service',
        audience: 'jwt-redis-session-api-clients',
      });

      expect(() => tokenService.verifyAccessToken(token)).toThrow(
        UnauthorizedError
      );
    });

    it('throws UnauthorizedError for a token with the wrong audience', () => {
      const token = sign({ sid: 'session-1' }, validSecret, {
        subject: 'user-1',
        issuer: 'jwt-redis-session-api',
        audience: 'some-other-audience',
      });

      expect(() => tokenService.verifyAccessToken(token)).toThrow(
        UnauthorizedError
      );
    });

    it('throws UnauthorizedError for a validly-signed token missing sid', () => {
      const token = sign({}, validSecret, { subject: 'user-1' });

      expect(() => tokenService.verifyAccessToken(token)).toThrow(
        UnauthorizedError
      );
    });

    it('throws UnauthorizedError for a validly-signed token missing role', () => {
      const token = sign({ sid: 'session-1' }, validSecret, {
        subject: 'user-1',
        issuer: 'jwt-redis-session-api',
        audience: 'jwt-redis-session-api-clients',
      });

      expect(() => tokenService.verifyAccessToken(token)).toThrow(
        UnauthorizedError
      );
    });

    it('round-trips the admin role', () => {
      const token = tokenService.signAccessToken(
        'user-1',
        'session-1',
        'admin'
      );

      expect(tokenService.verifyAccessToken(token).role).toBe('admin');
    });

    it('throws UnauthorizedError for an expired token', () => {
      const token = sign({ sid: 'session-1' }, validSecret, {
        subject: 'user-1',
        expiresIn: -10,
      });

      expect(() => tokenService.verifyAccessToken(token)).toThrow(
        UnauthorizedError
      );
    });

    it('throws UnauthorizedError for a token signed with a different algorithm (algorithm confusion)', () => {
      const token = sign({ sid: 'session-1' }, validSecret, {
        subject: 'user-1',
        algorithm: 'HS384',
      });

      expect(() => tokenService.verifyAccessToken(token)).toThrow(
        UnauthorizedError
      );
    });

    it('throws UnauthorizedError for an unsigned "none"-algorithm token', () => {
      const header = Buffer.from(
        JSON.stringify({ alg: 'none', typ: 'JWT' })
      ).toString('base64url');
      const payload = Buffer.from(
        JSON.stringify({ sub: 'user-1', sid: 'session-1' })
      ).toString('base64url');
      const noneAlgToken = `${header}.${payload}.`;

      expect(() => tokenService.verifyAccessToken(noneAlgToken)).toThrow(
        UnauthorizedError
      );
    });
  });

  describe('generateRefreshToken', () => {
    it('returns a validator and its sha256 hash', () => {
      const { validator, hash } = tokenService.generateRefreshToken();

      expect(validator).toEqual(expect.any(String));
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
      expect(tokenService.validatorMatchesHash(validator, hash)).toBe(true);
    });

    it('returns a different validator on every call', () => {
      const first = tokenService.generateRefreshToken();
      const second = tokenService.generateRefreshToken();

      expect(first.validator).not.toEqual(second.validator);
    });
  });

  describe('splitRefreshToken', () => {
    it('splits a well-formed token into sessionId and validator', () => {
      expect(tokenService.splitRefreshToken('session-1.the-validator')).toEqual(
        { sessionId: 'session-1', validator: 'the-validator' }
      );
    });

    it('splits only on the first separator', () => {
      expect(tokenService.splitRefreshToken('session-1.a.b.c')).toEqual({
        sessionId: 'session-1',
        validator: 'a.b.c',
      });
    });

    it('returns null when there is no separator', () => {
      expect(tokenService.splitRefreshToken('no-separator-here')).toBeNull();
    });

    it('returns null when the sessionId or validator half is empty', () => {
      expect(tokenService.splitRefreshToken('.validator')).toBeNull();
      expect(tokenService.splitRefreshToken('session-1.')).toBeNull();
    });
  });

  describe('validatorMatchesHash', () => {
    it('returns false for a non-matching validator', () => {
      const { hash } = tokenService.generateRefreshToken();

      expect(tokenService.validatorMatchesHash('wrong-validator', hash)).toBe(
        false
      );
    });

    it('returns false when the stored hash is a different length', () => {
      expect(
        tokenService.validatorMatchesHash('any-validator', 'too-short')
      ).toBe(false);
    });
  });
});
