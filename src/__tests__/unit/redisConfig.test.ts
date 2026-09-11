describe('redisConfig', () => {
  const originalHost = process.env.REDIS_HOST;
  const originalPort = process.env.REDIS_PORT;
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
  });

  it('uses configured host/port when both are set', () => {
    process.env.REDIS_HOST = 'redis.example.com';
    process.env.REDIS_PORT = '6380';

    require('../../redisConfig');

    expect(RedisMock).toHaveBeenCalledWith({
      host: 'redis.example.com',
      port: 6380,
    });
  });

  it('falls back to localhost:6379 when unset', () => {
    delete process.env.REDIS_HOST;
    delete process.env.REDIS_PORT;

    require('../../redisConfig');

    expect(RedisMock).toHaveBeenCalledWith({ host: 'localhost', port: 6379 });
  });
});
