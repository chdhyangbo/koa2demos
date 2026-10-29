const Router = require('koa-router');
const DB = require('../db/index.js');
const { isAllowedOrigin } = require('../utils/origin');
const { checkSecret } = require('../utils/password');

const router = new Router({ prefix: '/api/roleTest' });
const COLLECTION = 'roleTestAccounts';
const MAX_SUBMISSIONS = 3;

class ApiError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function jsonError(ctx, message, status = 400, cc = 1) {
  ctx.status = status;
  ctx.body = { message, cc };
}

function bodyString(ctx, key) {
  const value = ctx.request.body ? ctx.request.body[key] : undefined;
  const raw = Array.isArray(value) ? value[0] : value;
  return raw == null ? '' : String(raw).trim();
}

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}

function publicAccount(account) {
  const max = Number(account.maxSubmissions) || MAX_SUBMISSIONS;
  const used = Math.min(Number(account.usedCount) || 0, max);
  return {
    username: account.username,
    used,
    remaining: Math.max(0, max - used),
    maxSubmissions: max,
  };
}

async function findAccount(username) {
  const accounts = await DB.find(COLLECTION, { username });
  return (accounts && accounts[0]) || null;
}

function readCredentials(ctx) {
  const username = normalizeUsername(bodyString(ctx, 'username'));
  const password = bodyString(ctx, 'password');
  if (!username || !password) {
    throw new ApiError('请输入账户和密码');
  }
  if (username.length > 64 || password.length > 128) {
    throw new ApiError('账户或密码格式不正确');
  }
  return { username, password };
}

async function authenticate(ctx) {
  const { username, password } = readCredentials(ctx);
  const account = await findAccount(username);
  if (!account || !checkSecret(password, account.passwordHash)) {
    throw new ApiError('账户或密码不正确', 401);
  }
  return account;
}

router.post('/login', async (ctx) => {
  if (!isAllowedOrigin(ctx)) return jsonError(ctx, '来源未获允许', 403);
  try {
    const account = await authenticate(ctx);
    ctx.body = { cc: 0, ...publicAccount(account) };
  } catch (error) {
    if (error instanceof ApiError) {
      jsonError(ctx, error.message, error.status);
    } else {
      console.error('[RoleTest] login failed:', error.message);
      jsonError(ctx, '登录失败，请稍后重试', 500);
    }
  }
});

router.post('/submit', async (ctx) => {
  if (!isAllowedOrigin(ctx)) return jsonError(ctx, '来源未获允许', 403);
  try {
    const account = await authenticate(ctx);
    const currentUsed = Number(account.usedCount) || 0;
    const max = Number(account.maxSubmissions) || MAX_SUBMISSIONS;
    if (currentUsed >= max) {
      throw new ApiError('这个账户的 3 次机会已经用完', 429);
    }

    const themeId = bodyString(ctx, 'themeId').slice(0, 64);
    const themeTitle = bodyString(ctx, 'themeTitle').slice(0, 64);
    const characterId = bodyString(ctx, 'characterId').slice(0, 64);
    const characterName = bodyString(ctx, 'characterName').slice(0, 64);
    const match = Math.max(0, Math.min(100, Number(bodyString(ctx, 'match')) || 0));

    const updateResult = await DB.increment(
      COLLECTION,
      { _id: account._id, usedCount: { $lt: max } },
      { usedCount: 1 },
    );
    const modified = updateResult && typeof updateResult.modifiedCount === 'number'
      ? updateResult.modifiedCount
      : (updateResult && updateResult.result ? updateResult.result.nModified : 0);
    if (!modified) {
      throw new ApiError('这个账户的 3 次机会已经用完', 429);
    }

    const used = currentUsed + 1;
    try {
      await DB.update(COLLECTION, { _id: account._id }, {
        lastSubmitAt: Date.now(),
        lastThemeId: themeId,
        lastThemeTitle: themeTitle,
        lastCharacterId: characterId,
        lastCharacterName: characterName,
        lastMatch: match,
      });
    } catch (error) {
      console.warn('[RoleTest] failed to save last result:', error.message);
    }

    ctx.body = {
      cc: 0,
      username: account.username,
      used,
      remaining: Math.max(0, max - used),
      maxSubmissions: max,
    };
  } catch (error) {
    if (error instanceof ApiError) {
      jsonError(ctx, error.message, error.status);
    } else {
      console.error('[RoleTest] submit failed:', error.message);
      jsonError(ctx, '提交失败，请稍后重试', 500);
    }
  }
});

module.exports = router;
module.exports.COLLECTION = COLLECTION;
module.exports.MAX_SUBMISSIONS = MAX_SUBMISSIONS;
