function withProtocol(host: string) {
  return host.startsWith("http://") || host.startsWith("https://")
    ? host
    : `https://${host}`;
}

export function canonicalOrigin() {
  const configured = process.env.APP_ORIGIN?.trim();
  if (configured) return new URL(withProtocol(configured)).origin;
  const productionHost = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (productionHost) return new URL(withProtocol(productionHost)).origin;
  return "http://localhost:3000";
}

export function trustedRequestOrigin(request: Request) {
  const requestUrl = new URL(request.url);
  if (
    requestUrl.hostname === "localhost" ||
    requestUrl.hostname === "127.0.0.1"
  )
    return requestUrl.origin;

  const allowedHosts = new Set(
    [
      process.env.APP_ORIGIN,
      process.env.VERCEL_URL,
      process.env.VERCEL_BRANCH_URL,
      process.env.VERCEL_PROJECT_PRODUCTION_URL,
    ]
      .filter(Boolean)
      .map((value) => new URL(withProtocol(String(value))).hostname),
  );
  if (!allowedHosts.has(requestUrl.hostname))
    throw new Error("This hostname is not configured for GitNorm.");
  return requestUrl.origin;
}
