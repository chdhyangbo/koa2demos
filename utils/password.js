const crypto = require('crypto');

function hashSecret(value) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(value), salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function checkSecret(received, stored) {
  if (typeof received !== 'string' || typeof stored !== 'string') return false;
  if (!stored.startsWith('scrypt$')) return false;
  const [, salt, expectedHex] = stored.split('$');
  if (!salt || !expectedHex) return false;
  const expected = Buffer.from(expectedHex, 'hex');
  const actual = crypto.scryptSync(received, salt, expected.length);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

module.exports = { hashSecret, checkSecret };
