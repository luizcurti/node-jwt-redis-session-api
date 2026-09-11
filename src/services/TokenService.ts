import { randomBytes, createHash, timingSafeEqual } from 'crypto';
import { sign, verify } from 'jsonwebtoken';
import { UnauthorizedError } from '../errors/AppError';

const ACCESS_TOKEN_EXPIRES_IN = '15m';
const REFRESH_TOKEN_VALIDATOR_BYTES = 32;
const MIN_SECRET_LENGTH = 32;
const JWT_ALGORITHM = 'HS256';
// Stable identifiers for this service, not per-environment config: `iss`
// says who signed the token, `aud` says who it's meant for. Rejecting a
// token from the wrong issuer/audience blocks it from being replayed
// against a different service that happens to share the same secret.
const JWT_ISSUER = 'jwt-redis-postgres-api';
const JWT_AUDIENCE = 'jwt-redis-postgres-api-clients';

export type AccessTokenPayload = {
  subject: string;
  sessionId: string;
};

export type RefreshTokenPair = {
  validator: string;
  hash: string;
};

export type SplitRefreshToken = {
  sessionId: string;
  validator: string;
};

export class TokenService {
  signAccessToken(userId: string, sessionId: string): string {
    return sign({ sid: sessionId }, this.getSecret(), {
      subject: userId,
      expiresIn: ACCESS_TOKEN_EXPIRES_IN,
      algorithm: JWT_ALGORITHM,
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
  }

  verifyAccessToken(token: string): AccessTokenPayload {
    try {
      const decoded = verify(token, this.getSecret(), {
        algorithms: [JWT_ALGORITHM],
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
      }) as {
        sub: string;
        sid: string;
      };

      if (!decoded.sub || !decoded.sid) {
        throw new Error('Malformed access token payload');
      }

      return { subject: decoded.sub, sessionId: decoded.sid };
    } catch {
      throw new UnauthorizedError('Invalid token');
    }
  }

  generateRefreshToken(): RefreshTokenPair {
    const validator = randomBytes(REFRESH_TOKEN_VALIDATOR_BYTES).toString(
      'base64url'
    );

    return { validator, hash: this.hashValidator(validator) };
  }

  splitRefreshToken(raw: string): SplitRefreshToken | null {
    const separatorIndex = raw.indexOf('.');

    if (separatorIndex <= 0 || separatorIndex === raw.length - 1) {
      return null;
    }

    return {
      sessionId: raw.slice(0, separatorIndex),
      validator: raw.slice(separatorIndex + 1),
    };
  }

  validatorMatchesHash(validator: string, hash: string): boolean {
    const candidate = Buffer.from(this.hashValidator(validator));
    const expected = Buffer.from(hash);

    if (candidate.length !== expected.length) {
      return false;
    }

    return timingSafeEqual(candidate, expected);
  }

  private hashValidator(validator: string): string {
    return createHash('sha256').update(validator).digest('hex');
  }

  private getSecret(): string {
    const secret = process.env.JWT_SECRET;

    if (!secret) {
      throw new Error('JWT_SECRET environment variable is not set');
    }

    if (secret.length < MIN_SECRET_LENGTH) {
      throw new Error(
        `JWT_SECRET must be at least ${MIN_SECRET_LENGTH} characters long ` +
          '(RFC 7518 recommends a key at least as long as the HMAC output ' +
          '— 256 bits — for HS256)'
      );
    }

    return secret;
  }
}
