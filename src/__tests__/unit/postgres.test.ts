import { logger } from '../../logger';
import { pool } from '../../postgres';

describe('postgres', () => {
  it('logs via the structured logger when the pool emits an error', () => {
    const loggerErrorSpy = jest
      .spyOn(logger, 'error')
      .mockImplementation(() => logger);
    const testError = new Error('connection lost');

    pool.emit('error', testError);

    expect(loggerErrorSpy).toHaveBeenCalledWith(
      { err: testError },
      'Unexpected error on idle PostgreSQL client'
    );

    loggerErrorSpy.mockRestore();
  });
});
