/**
 * Accept either a base URL such as https://api.openai.com/v1 or a complete
 * endpoint. A complete endpoint is detected by its suffix.
 */
export function resolveEndpoint(baseUrl: string, suffix: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '');
  if (base.endsWith(`/${suffix}`)) return base;
  return `${base}/${suffix}`;
}
