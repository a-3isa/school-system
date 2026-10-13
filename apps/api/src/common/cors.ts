/**
 * Which web pages may call the API from a browser (the dashboard and the parent app
 * on the web). The native apps send no Origin and are not affected.
 *
 * CORS_ORIGINS is a comma-separated list. While developing and with no list, any
 * page on localhost or 127.0.0.1 is allowed; in production there is no default.
 */
const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

export function allowedOrigins(env: NodeJS.ProcessEnv = process.env): (string | RegExp)[] {
  const listed = (env.CORS_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  if (listed.length) return listed;
  if (env.NODE_ENV === 'production') {
    throw new Error('Set CORS_ORIGINS to the dashboard and parent web addresses (comma-separated) before running in production.');
  }
  return [LOCAL];
}
