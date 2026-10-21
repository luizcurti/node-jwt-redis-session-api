import { parseTrustProxy } from '../../trustProxy';

describe('parseTrustProxy', () => {
  it.each([undefined, '', '  ', 'false'])('trusts no proxy for %p', value => {
    expect(parseTrustProxy(value)).toBe(false);
  });

  it('parses a hop count as a number', () => {
    expect(parseTrustProxy(' 2 ')).toBe(2);
  });

  it('passes a subnet list through to Express unchanged', () => {
    expect(parseTrustProxy('loopback, 10.0.0.0/8')).toBe(
      'loopback, 10.0.0.0/8'
    );
  });

  it('refuses a blanket "true", which would let clients choose their own IP', () => {
    expect(() => parseTrustProxy('true')).toThrow(/X-Forwarded-For/);
  });
});
