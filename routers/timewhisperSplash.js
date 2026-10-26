const Router = require('koa-router');
const DB = require('../db/index.js');

const router = new Router();
const CONFIG_COLLECTION = 'config';
const CONFIG_KEY = 'timewhisperSplashAd';
const DEFAULT_CONFIG = {
  enabled: false,
  contentUrl: '',
  url: '',
  durationSeconds: 5,
};

function clampDuration(value) {
  const duration = Number(value);
  if (!Number.isFinite(duration)) return DEFAULT_CONFIG.durationSeconds;
  return Math.min(15, Math.max(3, Math.round(duration)));
}

function normalizeUrl(value) {
  const url = String(value == null ? '' : value).trim().slice(0, 1000);
  if (!url) return '';
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return parsed.toString();
  } catch (error) {
    return '';
  }
}

function normalizeConfig(value) {
  const source = value && typeof value === 'object' ? value : {};
  const contentUrl = normalizeUrl(source.contentUrl) || normalizeUrl(source.url);
  const url = normalizeUrl(source.url);
  return {
    enabled: source.enabled === true || source.enabled === 'true' || source.enabled === 1 || source.enabled === '1',
    contentUrl,
    url,
    durationSeconds: clampDuration(source.durationSeconds),
    updatedAt: source.updatedAt || null,
  };
}

async function readConfig() {
  const rows = await DB.find(CONFIG_COLLECTION, { key: CONFIG_KEY });
  const row = rows && rows[0];
  const value = row && row.value && typeof row.value === 'object' ? row.value : row;
  return normalizeConfig(value);
}

async function writeConfig(payload) {
  const config = normalizeConfig({
    ...payload,
    updatedAt: new Date().toISOString(),
  });
  const rows = await DB.find(CONFIG_COLLECTION, { key: CONFIG_KEY });
  if (rows && rows.length > 0) {
    await DB.update(CONFIG_COLLECTION, { key: CONFIG_KEY }, { value: config });
  } else {
    await DB.insert(CONFIG_COLLECTION, { key: CONFIG_KEY, value: config });
  }
  return config;
}

router.get('/api/timewhisper/splash', async (ctx) => {
  try {
    ctx.body = { cc: 0, data: await readConfig() };
  } catch (error) {
    ctx.status = 500;
    ctx.body = { cc: 1, message: '开屏配置读取失败' };
  }
});

router.get('/api/admin/timewhisper-splash', async (ctx) => {
  try {
    ctx.body = { cc: 0, config: await readConfig() };
  } catch (error) {
    ctx.status = 500;
    ctx.body = { cc: 1, message: '开屏配置读取失败' };
  }
});

router.post('/api/admin/timewhisper-splash', async (ctx) => {
  const body = ctx.request.body || {};
  const enabled = body.enabled === true || body.enabled === 'true' || body.enabled === 1 || body.enabled === '1';
  const rawContentUrl = String(body.contentUrl == null ? '' : body.contentUrl).trim();
  const rawClickUrl = String(body.url == null ? '' : body.url).trim();
  const contentUrl = normalizeUrl(rawContentUrl) || normalizeUrl(rawClickUrl);
  const clickUrl = normalizeUrl(rawClickUrl);

  if (rawContentUrl && !normalizeUrl(rawContentUrl)) {
    ctx.body = { cc: 1, message: '广告展示网页必须是有效的 http/https 地址' };
    return;
  }
  if (rawClickUrl && !clickUrl) {
    ctx.body = { cc: 1, message: '点击跳转链接必须是有效的 http/https 地址' };
    return;
  }
  if (enabled && !contentUrl) {
    ctx.body = { cc: 1, message: '启用开屏广告时必须填写广告展示网页地址' };
    return;
  }

  try {
    const config = await writeConfig({
      enabled,
      contentUrl,
      url: clickUrl,
      durationSeconds: body.durationSeconds,
    });
    ctx.body = { cc: 0, message: '保存成功', config };
  } catch (error) {
    ctx.status = 500;
    ctx.body = { cc: 1, message: '开屏配置保存失败' };
  }
});

module.exports = router;