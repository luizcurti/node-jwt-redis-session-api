describe('redisConfig', () => {
  const originalHost = process.env.REDIS_HOST;
  const originalPort = process.env.REDIS_PORT;
  const originalPassword = process.env.REDIS_PASSWORD;
  const originalTls = process.env.REDIS_TLS;
  let RedisMock: jest.Mock;

  beforeEach(() => {
    jest.resetModules();
    RedisMock = jest.fn();
    jest.doMock('ioredis', () => ({
      __esModule: true,
      default: RedisMock,
    }));
  });

  afterEach(() => {
    process.env.REDIS_HOST = originalHost;
    process.env.REDIS_PORT = originalPort;
    process.env.REDIS_PASSWORD = originalPassword;
    process.env.REDIS_TLS = originalTls;
  });

  it('uses configured host/port/password when set', () => {
    delete process.env.REDIS_TLS;
    process.env.REDIS_HOST = 'redis.example.com';
    process.env.REDIS_PORT = '6380';
    process.env.REDIS_PASSWORD = 's3cret';

    require('../../redisConfig');

    expect(RedisMock).toHaveBeenCalledWith({
      host: 'redis.example.com',
      port: 6380,
      password: 's3cret',
    });
  });

  it('falls back to localhost:6379 when unset', () => {
    delete process.env.REDIS_HOST;
    delete process.env.REDIS_PORT;
    delete process.env.REDIS_PASSWORD;
    delete process.env.REDIS_TLS;

    require('../../redisConfig');

    expect(RedisMock).toHaveBeenCalledWith({
      host: 'localhost',
      port: 6379,
      password: undefined,
    });
  });

  it('enables TLS when REDIS_TLS=true (e.g. ElastiCache with an AUTH token)', () => {
    process.env.REDIS_HOST = 'master.example.cache.amazonaws.com';
    process.env.REDIS_PORT = '6379';
    process.env.REDIS_PASSWORD = 's3cret';
    process.env.REDIS_TLS = 'true';

    require('../../redisConfig');

    expect(RedisMock).toHaveBeenCalledWith({
      host: 'master.example.cache.amazonaws.com',
      port: 6379,
      password: 's3cret',
      tls: {},
    });
  });
});
