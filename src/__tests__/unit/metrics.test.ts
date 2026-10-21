import { httpRequestDuration, registry } from '../../metrics';

describe('metrics', () => {
  it('registers the default Node.js process metrics', async () => {
    const output = await registry.metrics();

    expect(output).toContain('process_cpu_user_seconds_total');
  });

  it('records an HTTP request duration observation with its labels', async () => {
    httpRequestDuration.observe(
      { method: 'GET', route: '/health', status: 200 },
      0.05
    );

    const output = await registry.metrics();

    expect(output).toContain('http_request_duration_seconds');
    expect(output).toContain('route="/health"');
  });
});
