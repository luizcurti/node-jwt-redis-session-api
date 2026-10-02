import { Request } from 'express';
import { refreshTokenSessionKey } from '../../../middleware/rateLimiter';

// createRedisRateLimiter is backed by RedisStore, which counts via Lua
// scripts executed *by Redis* — not something a unit-level mock can
// meaningfully emulate. Its counting/blocking behavior is covered by
// rateLimiter.integration.test.ts against a real Redis instance.
describe('refreshTokenSessionKey', () => {
  function req(body: unknown, ip = '203.0.113.7'): Request {
    return { body, ip } as unknown as Request;
  }

  it('keys by the session id half of the refresh token', () => {
    expect(
      refreshTokenSessionKey(req({ refreshToken: 'session-1.validator' }))
    ).toBe('session:session-1');
  });

  it('falls back to the client IP when there is no token', () => {
    expect(refreshTokenSessionKey(req({}))).toBe('ip:203.0.113.7');
  });

  it('falls back to the client IP when the body is missing', () => {
    expect(refreshTokenSessionKey(req(undefined))).toBe('ip:203.0.113.7');
  });

  it('falls back to the client IP for a token with no separator', () => {
    expect(refreshTokenSessionKey(req({ refreshToken: 'garbage' }))).toBe(
      'ip:203.0.113.7'
    );
  });

  it('falls back to the client IP when the session id is implausibly long', () => {
    const token = `${'a'.repeat(65)}.validator`;

    expect(refreshTokenSessionKey(req({ refreshToken: token }))).toBe(
      'ip:203.0.113.7'
    );
  });

  it('groups IPv6 clients by /56 subnet so rotating addresses does not help', () => {
    expect(
      refreshTokenSessionKey(req({}, '2001:db8:abcd:12ff:1111:2222:3333:4444'))
    ).toBe(refreshTokenSessionKey(req({}, '2001:db8:abcd:1200::1')));
  });

  it('tolerates a request with no IP', () => {
    const noIp = { body: {} } as unknown as Request;

    expect(refreshTokenSessionKey(noIp)).toBe('ip:');
  });
});
