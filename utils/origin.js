const { URL } = require('url');

const STATIC_ORIGINS = [
  'https://appassets.androidplatform.net',
  'https://cssshop.com.cn',
  'https://www.cssshop.com.cn',
];

const LOCAL_ORIGIN_PATTERN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;

function configuredOrigins() {
  const extra = (process.env.TIMEWHISPER_ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return new Set([...STATIC_ORIGINS, ...extra]);
}

/**
 * Native WebView requests usually have no Origin header. Browser requests must
 * either match an allow-listed origin, come from localhost for development, or
 * share the host that served the API.
 */
function isAllowedOrigin(ctx, origin = ctx.get('origin')) {
  if (!origin) return true;
  if (configuredOrigins().has(origin)) return true;
  if (LOCAL_ORIGIN_PATTERN.test(origin)) return true;
  try {
    const parsed = new URL(origin);
    const host = ctx.get('host');
    return !!host && parsed.host === host;
  } catch (error) {
    return false;
  }
}

module.exports = { isAllowedOrigin };
