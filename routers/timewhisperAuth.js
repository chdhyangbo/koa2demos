const Router = require('koa-router');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const DB = require('../db/index.js');
const { isAllowedOrigin } = require('../utils/origin');

const router = new Router({ prefix: '/api/timewhisper' });
const CODE_COLLECTION = 'timewhisperEmailCodes';
const USER_COLLECTION = 'user';
const CODE_TTL_MS = 10 * 60 * 1000;
const CODE_RESEND_MS = 60 * 1000;
const MAX_CODE_ATTEMPTS = 5;
const JWT_SECRET = process.env.JWT_SECRET || 'ybadmin';

function enforceTimeWhisperOrigin(ctx) {
  return isAllowedOrigin(ctx);
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function checkPassword(received, stored) {
  if (typeof received !== 'string' || typeof stored !== 'string') return false;
  if (stored.startsWith('scrypt$')) {
    const [, salt, expectedHex] = stored.split('$');
    if (!salt || !expectedHex) return false;
    const expected = Buffer.from(expectedHex, 'hex');
    const actual = crypto.scryptSync(received, salt, expected.length);
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  }
  const receivedHash = crypto.createHash('sha256').update(received).digest('hex');
  const storedHash = crypto.createHash('sha256').update(stored).digest('hex');
  return received === stored || receivedHash === stored || received === storedHash;
}

function mailTransport() {
  const { SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    throw new Error('邮件服务未配置，请设置 SMTP_HOST、SMTP_USER 和 SMTP_PASS');
  }
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT || 587),
    secure: SMTP_SECURE === 'true',
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
}

function extractAddress(value) {
  const match = String(value || '').match(/<([^>]+)>|([^\s<>]+@[^\s<>]+)/);
  return match ? (match[1] || match[2]).trim() : '';
}

// QQ/Foxmail and most SMTP providers reject a From address that differs from
// the authenticated account. Keep the display name but fall back to SMTP_USER.
function resolveSender() {
  const authUser = String(process.env.SMTP_USER || '').trim();
  const configured = String(process.env.SMTP_FROM || '').trim();
  if (!configured) return authUser;
  const address = extractAddress(configured);
  if (!address || address.toLowerCase() === authUser.toLowerCase()) return configured;
  const nameMatch = configured.match(/^([^<]*)</);
  const name = nameMatch ? nameMatch[1].trim().replace(/^"(.*)"$/, '$1') : '';
  console.warn('[TimeWhisperAuth] SMTP_FROM 与 SMTP_USER 发件地址不一致，已改用 SMTP_USER 发件。');
  return name ? { name, address: authUser } : authUser;
}

function jsonError(ctx, message, status = 400, cc = 1) {
  ctx.status = status;
  ctx.body = { message, cc };
}

async function findUserByUsername(username) {
  const users = await DB.find(USER_COLLECTION, { username });
  return users && users[0];
}

// A TimeWhisper account that was created but has not passed email verification yet.
function isPendingTimewhisperUser(user, email) {
  return !!user &&
    user.timewhisperAuth === true &&
    !user.emailVerified &&
    normalizeEmail(user.email) === email;
}

router.post('/send-email-code', async (ctx) => {
  if (!enforceTimeWhisperOrigin(ctx)) return jsonError(ctx, '来源未获允许', 403);
  const email = normalizeEmail(ctx.request.body?.email);
  const username = String(ctx.request.body?.username || '').trim();
  if (!validEmail(email)) return jsonError(ctx, '请输入有效的邮箱地址');
  if (username.length < 2 || username.length > 40) return jsonError(ctx, '用户名需为 2-40 个字符');

  let transport;
  try {
    transport = mailTransport();
    await transport.verify();
  } catch (error) {
    console.error('[TimeWhisperAuth] mail transport unavailable:', error.message);
    return jsonError(
      ctx,
      error.message.includes('邮件服务未配置') ? error.message : '邮件服务连接失败，请稍后重试',
      500
    );
  }

  try {
    const [emailMatches, usernameMatch] = await Promise.all([
      DB.find(USER_COLLECTION, { email }),
      findUserByUsername(username),
    ]);
    const emailOwner = emailMatches?.[0];
    if (emailOwner && !isPendingTimewhisperUser(emailOwner, email)) {
      return jsonError(ctx, '该邮箱已注册');
    }
    if (emailOwner && emailOwner.username !== username) {
      return jsonError(ctx, '该邮箱已注册');
    }
    if (usernameMatch && !isPendingTimewhisperUser(usernameMatch, email)) {
      return jsonError(ctx, '该用户名已被使用');
    }

    const now = Date.now();
    const existing = (await DB.find(CODE_COLLECTION, { email, purpose: 'register' }))?.[0];
    if (existing && now - new Date(existing.sentAt).getTime() < CODE_RESEND_MS) {
      return jsonError(ctx, '请稍后再获取验证码');
    }

    const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
    const secret = process.env.EMAIL_CODE_SECRET || JWT_SECRET;
    const codeHash = crypto.createHmac('sha256', secret).update(`${email}:${code}`).digest('hex');
    const record = {
      email,
      purpose: 'register',
      codeHash,
      sentAt: new Date(now),
      expiresAt: new Date(now + CODE_TTL_MS),
      attempts: 0,
    };

    // Persist cooldown and code expiry before sending to prevent rapid mail flooding.
    if (existing?._id) {
      await DB.update(CODE_COLLECTION, { _id: DB.getObjectId(existing._id) }, record);
    } else {
      await DB.insert(CODE_COLLECTION, record);
    }

    const from = resolveSender();
    try {
      await transport.sendMail({
        from,
        to: email,
        subject: '时语 TimeWhisper 邮箱验证码',
        text: `你的注册验证码是 ${code}，10 分钟内有效。若非本人操作，请忽略此邮件。`,
        html: `<p>你的时语注册验证码是：</p><p style="font-size:28px;font-weight:bold;letter-spacing:6px">${code}</p><p>验证码 10 分钟内有效。若非本人操作，请忽略此邮件。</p>`,
      });
    } catch (mailError) {
      if (existing?._id) {
        await DB.update(CODE_COLLECTION, { _id: DB.getObjectId(existing._id) }, { sentAt: new Date(0), codeHash: '', expiresAt: new Date(0) });
      } else {
        await DB.remove(CODE_COLLECTION, { email, purpose: 'register' });
      }
      throw mailError;
    }

    ctx.body = { message: '验证码已发送，请查收邮箱', cc: 0, expiresIn: CODE_TTL_MS / 1000 };
  } catch (error) {
    console.error('[TimeWhisperAuth] send email code failed:', error.message);
    jsonError(ctx, '验证码发送失败，请稍后重试', 500);
  }
});

router.post('/register', async (ctx) => {
  if (!enforceTimeWhisperOrigin(ctx)) return jsonError(ctx, '来源未获允许', 403);
  const username = String(ctx.request.body?.username || '').trim();
  const email = normalizeEmail(ctx.request.body?.email);
  const password = String(ctx.request.body?.password || '');
  const verificationCode = String(ctx.request.body?.verificationCode || '').trim();

  if (username.length < 2 || username.length > 40) return jsonError(ctx, '用户名需为 2-40 个字符');
  if (!validEmail(email)) return jsonError(ctx, '请输入有效的邮箱地址');
  if (password.length < 8 || password.length > 128) return jsonError(ctx, '密码长度需为 8-128 个字符');
  if (!/^\d{6}$/.test(verificationCode)) return jsonError(ctx, '请输入 6 位邮箱验证码');

  try {
    const codeRecord = (await DB.find(CODE_COLLECTION, { email, purpose: 'register' }))?.[0];
    if (!codeRecord || new Date(codeRecord.expiresAt).getTime() <= Date.now()) {
      return jsonError(ctx, '验证码已过期，请重新获取');
    }
    if ((codeRecord.attempts || 0) >= MAX_CODE_ATTEMPTS) return jsonError(ctx, '验证码错误次数过多，请重新获取');
    const secret = process.env.EMAIL_CODE_SECRET || JWT_SECRET;
    const actual = crypto.createHmac('sha256', secret).update(`${email}:${verificationCode}`).digest();
    const expected = Buffer.from(codeRecord.codeHash, 'hex');
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
      await DB.update(CODE_COLLECTION, { _id: DB.getObjectId(codeRecord._id) }, { attempts: (codeRecord.attempts || 0) + 1 });
      return jsonError(ctx, '邮箱验证码错误');
    }

    const [emailMatches, usernameMatch] = await Promise.all([
      DB.find(USER_COLLECTION, { email }),
      findUserByUsername(username),
    ]);
    const emailOwner = emailMatches?.[0];
    if (emailOwner && !isPendingTimewhisperUser(emailOwner, email)) {
      return jsonError(ctx, '该邮箱已注册');
    }
    if (emailOwner && emailOwner.username !== username) {
      return jsonError(ctx, '该邮箱已注册');
    }
    if (usernameMatch && !isPendingTimewhisperUser(usernameMatch, email)) {
      return jsonError(ctx, '该用户名已被使用');
    }
    if (emailOwner && usernameMatch && emailOwner._id.toString() !== usernameMatch._id.toString()) {
      return jsonError(ctx, '账号信息冲突，请更换用户名');
    }

    const now = new Date();
    const targetUser = emailOwner || usernameMatch;
    const userRecord = {
      username,
      email,
      password: hashPassword(password),
      passwordUpdatedAt: now,
      emailVerified: true,
      emailVerifiedAt: now,
      timewhisperAuth: true,
      createdAt: targetUser?.createdAt ? new Date(targetUser.createdAt) : now,
      fromWay: 'timewhisper',
    };

    let userId;
    if (targetUser) {
      userId = targetUser.userId || targetUser._id.toString();
      await DB.update(USER_COLLECTION, { _id: DB.getObjectId(targetUser._id) }, { ...userRecord, userId });
    } else {
      const inserted = await DB.insert(USER_COLLECTION, userRecord);
      userId = inserted.insertedId.toString();
      await DB.update(USER_COLLECTION, { _id: DB.getObjectId(userId) }, { userId });
    }
    await DB.remove(CODE_COLLECTION, { _id: DB.getObjectId(codeRecord._id) });

    const token = jwt.sign({
      userId,
      username,
      email,
      emailVerified: true,
      time: Date.now(),
      timeout: 1000 * 24 * 60 * 60,
    }, JWT_SECRET);
    ctx.body = { message: '注册成功', cc: 0, token, userId, username, email };
  } catch (error) {
    console.error('[TimeWhisperAuth] registration failed:', error.message);
    jsonError(ctx, '注册失败，请稍后重试', 500);
  }
});

router.post('/login', async (ctx) => {
  if (!enforceTimeWhisperOrigin(ctx)) return jsonError(ctx, '来源未获允许', 403);
  const username = String(ctx.request.body?.username || '').trim();
  const password = String(ctx.request.body?.password || '');
  if (!username || !password) return jsonError(ctx, '请输入用户名和密码');

  try {
    const users = await DB.find(USER_COLLECTION, { username });
    const user = users?.[0];
    if (!user || !user.timewhisperAuth || !checkPassword(password, user.password)) {
      return jsonError(ctx, '用户名或密码错误', 401);
    }
    if (user.timewhisperAuth && !user.emailVerified) {
      const codeRecord = (await DB.find(CODE_COLLECTION, { email: user.email, purpose: 'register' }))?.[0];
      const sentAt = codeRecord?.sentAt ? new Date(codeRecord.sentAt).getTime() : 0;
      ctx.status = 403;
      ctx.body = {
        message: '邮箱尚未验证，请完成邮箱验证后登录',
        cc: 1,
        emailVerificationRequired: true,
        email: user.email,
        canResend: Date.now() - sentAt >= CODE_RESEND_MS,
      };
      return;
    }

    // Upgrade legacy plaintext/SHA-256 passwords to scrypt after successful login.
    if (!String(user.password).startsWith('scrypt$')) {
      const newPassword = hashPassword(password);
      await DB.update(USER_COLLECTION, { _id: DB.getObjectId(user._id) }, { password: newPassword, passwordUpdatedAt: new Date() });
    }

    const userId = user.userId || user._id.toString();
    if (!user.userId) await DB.update(USER_COLLECTION, { _id: DB.getObjectId(user._id) }, { userId });
    const token = jwt.sign({
      userId,
      username: user.username,
      email: user.email || '',
      emailVerified: !!user.emailVerified,
      time: Date.now(),
      timeout: 1000 * 24 * 60 * 60,
    }, JWT_SECRET);
    ctx.body = { message: '登录成功', cc: 0, token, userId, username: user.username, email: user.email || '' };
  } catch (error) {
    console.error('[TimeWhisperAuth] login failed:', error.message);
    jsonError(ctx, '登录失败，请稍后重试', 500);
  }
});

router.get('/session', async (ctx) => {
  if (!enforceTimeWhisperOrigin(ctx)) return jsonError(ctx, '来源未获允许', 403);
  const token = ctx.get('token');
  if (!token) return jsonError(ctx, '登录状态已失效', 401);
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (Date.now() - payload.time > payload.timeout) return jsonError(ctx, '登录状态已失效', 401);
    const users = await DB.find(USER_COLLECTION, { userId: payload.userId, timewhisperAuth: true });
    const user = users?.[0];
    if (!user || !user.emailVerified) return jsonError(ctx, '登录状态已失效', 401);
    ctx.body = {
      message: '登录状态有效',
      cc: 0,
      userId: user.userId,
      username: user.username,
      email: user.email || '',
      emailVerified: true,
    };
  } catch (error) {
    jsonError(ctx, '登录状态已失效', 401);
  }
});

router.post('/delete-account', async (ctx) => {
  if (!enforceTimeWhisperOrigin(ctx)) return jsonError(ctx, '来源未获允许', 403);
  const token = ctx.get('token');
  if (!token) return jsonError(ctx, '登录状态已失效', 401);

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return jsonError(ctx, '登录状态已失效', 401);
  }
  if (Date.now() - payload.time > payload.timeout) return jsonError(ctx, '登录状态已失效', 401);

  try {
    const users = await DB.find(USER_COLLECTION, { userId: payload.userId, timewhisperAuth: true });
    const user = users?.[0];
    if (!user) return jsonError(ctx, '登录状态已失效', 401);

    await DB.remove(USER_COLLECTION, { _id: DB.getObjectId(user._id) });
    if (user.email) {
      await DB.remove(CODE_COLLECTION, { email: normalizeEmail(user.email) });
    }
    console.log('[TimeWhisperAuth] account deleted:', payload.userId);
    ctx.body = { message: '账户已注销', cc: 0 };
  } catch (error) {
    console.error('[TimeWhisperAuth] delete account failed:', error.message);
    jsonError(ctx, '注销失败，请稍后重试', 500);
  }
});

module.exports = router;
