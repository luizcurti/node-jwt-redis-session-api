// Behind a load balancer every request arrives from the proxy's IP, so
// every per-IP limit would be one shared bucket. TRUST_PROXY tells Express
// which hops to believe X-Forwarded-For from: a hop count ("1") or a
// subnet list ("loopback, 10.0.0.0/8"). A blanket `true` is refused — it
// trusts whatever X-Forwarded-For a client sends, so anyone could pick
// their own IP and walk around every per-IP limit.
export function parseTrustProxy(
  value: string | undefined
): boolean | number | string {
  const normalized = value?.trim() ?? '';

  if (normalized === '' || normalized === 'false') {
    return false;
  }

  if (normalized === 'true') {
    throw new Error(
      'TRUST_PROXY=true would trust a client-supplied X-Forwarded-For; ' +
        'set the number of proxy hops (e.g. 1) or the proxy subnets instead'
    );
  }

  return /^\d+$/.test(normalized) ? Number(normalized) : normalized;
}
