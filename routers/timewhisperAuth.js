const Router = require('koa-router');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const DB = require('../db/index.js');
const { isAllowedOrigin } = require('../utils/origin');

const router = new Router({ prefix: '/api/timewhisper' });
const CODE_COLLECTION = 'timewhisperEmailCodes';
const USER_COLLECTION = 'user';
const CAPSULE_COLLECTION = 'timewhisperCapsules';
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

const FEEDBACK_MAX_IMAGES = 3;
const FEEDBACK_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const FEEDBACK_MAX_TOTAL_BYTES = 12 * 1024 * 1024;
const FEEDBACK_COOLDOWN_MS = 60 * 1000;
const IMAGE_MIME_BY_EXT = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};
const IMAGE_EXT_BY_MIME = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};
const feedbackCooldowns = new Map();

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

function detectImageMime(file) {
  const declared = String(file.type || file.mimetype || '').toLowerCase();
  if (IMAGE_EXT_BY_MIME[declared]) return declared;
  const extension = path.extname(String(file.name || file.originalFilename || file.path || '')).toLowerCase();
  return IMAGE_MIME_BY_EXT[extension] || '';
}

function getUploadedFeedbackFiles(ctx) {
  const raw = ctx.request.files && ctx.request.files.images;
  if (!raw) return [];
  return (Array.isArray(raw) ? raw : [raw]).filter((file) => file && file.path);
}

function removeUploadedFiles(files) {
  for (const file of files) {
    if (!file || !file.path) continue;
    try {
      fs.unlinkSync(path.resolve(file.path));
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.warn('[TimeWhisperAuth] failed to remove uploaded file:', error.message);
      }
    }
  }
}

function removeCapsuleVoiceFiles(capsules) {
  const prefixes = ['/timewhisper/voice/', '/timewhisper/images/'];
  for (const capsule of capsules || []) {
    const urls = [
      capsule.content && capsule.content.voiceUrl,
      ...(capsule.content && Array.isArray(capsule.content.images) ? capsule.content.images : []),
      capsule.response && capsule.response.voiceUrl,
    ].filter(Boolean);
    for (const url of urls) {
      if (!prefixes.some((prefix) => String(url).startsWith(prefix))) continue;
      try {
        fs.unlinkSync(path.join(__dirname, '../static', url));
      } catch (error) {
        if (error.code !== 'ENOENT') {
          console.warn('[TimeWhisperAuth] failed to remove capsule file:', error.message);
        }
      }
    }
  }
}

async function authenticateRequest(ctx) {
  const token = ctx.get('token');
  if (!token) {
    jsonError(ctx, '登录状态已失效，请重新登录', 401);
    return null;
  }

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch (error) {
    jsonError(ctx, '登录状态已失效，请重新登录', 401);
    return null;
  }
  if (!payload.time || Date.now() - payload.time > payload.timeout) {
    jsonError(ctx, '登录状态已失效，请重新登录', 401);
    return null;
  }

  try {
    const users = await DB.find(USER_COLLECTION, { userId: payload.userId, timewhisperAuth: true });
    const user = users && users[0];
    if (!user || !user.emailVerified) {
      jsonError(ctx, '登录状态已失效，请重新登录', 401);
      return null;
    }
    return user;
  } catch (error) {
    console.error('[TimeWhisperAuth] feedback auth failed:', error.message);
    jsonError(ctx, '登录状态校验失败，请稍后重试', 500);
    return null;
  }
}

function buildVerificationCodeEmail({ code, email, expiresInMinutes }) {
  const safeCode = escapeHtml(code);
  const safeEmail = escapeHtml(email);
  const safeMinutes = escapeHtml(String(expiresInMinutes));

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>时语 TimeWhisper 邮箱验证码</title>
</head>
<body style="margin:0;padding:0;background:#EEF2F8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">你的注册验证码是 ${safeCode}，${safeMinutes} 分钟内有效。</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EEF2F8;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#FFFFFF;border-radius:18px;overflow:hidden;box-shadow:0 10px 30px rgba(15,23,42,0.08);">
          <tr><td style="height:6px;background:#FFD700;background:linear-gradient(90deg,#FFD700 0%,#FF9F1C 100%);"></td></tr>
          <tr>
            <td style="padding:30px 32px 10px 32px;">
              <div style="font-size:12px;letter-spacing:2px;color:#B8960C;font-weight:700;">TIMEWHISPER</div>
              <div style="font-size:26px;line-height:1.35;color:#0F172A;font-weight:700;margin-top:8px;">验证你的邮箱</div>
              <div style="font-size:14px;line-height:1.7;color:#667085;margin-top:8px;">欢迎来到时语。完成邮箱验证后，就可以开始给未来的自己写信了。</div>
            </td>
          </tr>
          <tr>
            <td style="padding:14px 32px 0 32px;">
              <div style="font-size:13px;line-height:1.6;color:#667085;">验证码已发送至 <span style="color:#101828;font-weight:600;">${safeEmail}</span></div>
            </td>
          </tr>
          <tr>
            <td style="padding:22px 32px 8px 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FFFDF5;border:1px solid #F5E6A8;border-radius:14px;">
                <tr>
                  <td align="center" style="padding:24px 20px 18px 20px;">
                    <div style="font-size:12px;letter-spacing:2px;color:#B8960C;font-weight:700;">注册验证码</div>
                    <div style="font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;font-size:38px;line-height:1.2;letter-spacing:10px;color:#0F172A;font-weight:700;padding:14px 0 10px 10px;">${safeCode}</div>
                    <div style="font-size:13px;line-height:1.6;color:#667085;">验证码 ${safeMinutes} 分钟内有效，请勿泄露给他人</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 32px 10px 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:12px;">
                <tr>
                  <td style="padding:15px 18px;font-size:13px;line-height:1.75;color:#475467;">
                    <strong style="color:#344054;">安全提示</strong><br />
                    如果这不是你本人的操作，请忽略此邮件，你的邮箱不会被注册。请勿将验证码转发给任何人。
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px 28px 32px;">
              <div style="border-top:1px solid #EAECF0;padding-top:16px;font-size:12px;line-height:1.7;color:#98A2B3;">
                此邮件由时语 TimeWhisper 自动发送，请勿直接回复。<br />
                与未来的自己对话 · TimeWhisper
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function buildFeedbackEmail({ username, email, userId, text, timeText, imageCids }) {
  const safeUsername = escapeHtml(username);
  const safeEmail = escapeHtml(email || '未填写');
  const safeUserId = escapeHtml(userId);
  const contentHtml = escapeHtml(text).replace(/\r?\n/g, '<br>');
  const imageRows = imageCids.map((cid, index) => `
    <tr>
      <td style="padding:0 0 16px 0;">
        <img src="cid:${cid}" alt="反馈图片 ${index + 1}" style="display:block;width:100%;max-width:616px;height:auto;border:1px solid #E4E7EC;border-radius:12px;" />
        <div style="font-size:12px;color:#98A2B3;padding-top:6px;">图片 ${index + 1} / ${imageCids.length}</div>
      </td>
    </tr>`).join('');

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>时语 TimeWhisper 用户反馈</title>
</head>
<body style="margin:0;padding:0;background:#EEF2F8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EEF2F8;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:680px;background:#FFFFFF;border-radius:18px;overflow:hidden;box-shadow:0 10px 30px rgba(15,23,42,0.08);">
          <tr><td style="height:6px;background:#FFD700;background:linear-gradient(90deg,#FFD700 0%,#FF9F1C 100%);"></td></tr>
          <tr>
            <td style="padding:30px 32px 14px 32px;">
              <div style="font-size:12px;letter-spacing:2px;color:#B8960C;font-weight:700;">TIMEWHISPER</div>
              <div style="font-size:24px;line-height:1.35;color:#0F172A;font-weight:700;margin-top:8px;">收到一条用户反馈</div>
              <div style="font-size:14px;line-height:1.6;color:#667085;margin-top:8px;">来自「${safeUsername}」的问题反馈，请及时查看。</div>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 32px 22px 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:12px;">
                <tr>
                  <td style="padding:16px 20px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="width:84px;padding:7px 0;font-size:13px;color:#667085;">用户</td>
                        <td style="padding:7px 0;font-size:14px;color:#101828;font-weight:600;">${safeUsername}</td>
                      </tr>
                      <tr>
                        <td style="width:84px;padding:7px 0;font-size:13px;color:#667085;">邮箱</td>
                        <td style="padding:7px 0;font-size:14px;color:#101828;">${safeEmail}</td>
                      </tr>
                      <tr>
                        <td style="width:84px;padding:7px 0;font-size:13px;color:#667085;">用户 ID</td>
                        <td style="padding:7px 0;font-size:13px;color:#475467;">${safeUserId}</td>
                      </tr>
                      <tr>
                        <td style="width:84px;padding:7px 0;font-size:13px;color:#667085;">时间</td>
                        <td style="padding:7px 0;font-size:13px;color:#475467;">${escapeHtml(timeText)}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 10px 32px;">
              <div style="font-size:13px;font-weight:700;color:#344054;margin-bottom:10px;">反馈内容</div>
              <div style="background:#FFFDF5;border:1px solid #F5E6A8;border-left:4px solid #FFD700;border-radius:10px;padding:18px 20px;font-size:15px;line-height:1.8;color:#1F2937;white-space:pre-wrap;">${contentHtml}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:22px 32px 6px 32px;">
              <div style="font-size:13px;font-weight:700;color:#344054;margin-bottom:12px;">问题截图 <span style="font-weight:400;color:#98A2B3;">（${imageCids.length} 张）</span></div>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${imageRows}</table>
            </td>
          </tr>
          <tr>
            <td style="padding:10px 32px 28px 32px;">
              <div style="border-top:1px solid #EAECF0;padding-top:16px;font-size:12px;line-height:1.7;color:#98A2B3;">
                此邮件由时语 TimeWhisper 问题反馈功能自动发送。<br />
                反馈时间：${escapeHtml(timeText)}
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

router.post('/feedback', async (ctx) => {
  if (!enforceTimeWhisperOrigin(ctx)) return jsonError(ctx, '来源未获允许', 403);
  const files = getUploadedFeedbackFiles(ctx);

  try {
    const user = await authenticateRequest(ctx);
    if (!user) return;

    const text = String(ctx.request.body?.text || '').trim();
    if (text.length < 5) return jsonError(ctx, '请填写至少 5 个字的反馈内容');
    if (text.length > 2000) return jsonError(ctx, '反馈内容不能超过 2000 字');
    if (files.length < 1) return jsonError(ctx, '请至少上传一张图片');
    if (files.length > FEEDBACK_MAX_IMAGES) {
      return jsonError(ctx, `最多上传 ${FEEDBACK_MAX_IMAGES} 张图片`);
    }

    const now = Date.now();
    const lastSentAt = feedbackCooldowns.get(user.userId) || 0;
    if (now - lastSentAt < FEEDBACK_COOLDOWN_MS) {
      return jsonError(ctx, '反馈提交过于频繁，请稍后再试', 429);
    }

    const recipient = extractAddress(process.env.SMTP_USER);
    if (!recipient) return jsonError(ctx, '反馈邮箱未配置，请联系管理员', 500);

    let totalBytes = 0;
    const attachments = [];
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const mime = detectImageMime(file);
      if (!mime) return jsonError(ctx, '仅支持 JPG、PNG、WebP 或 GIF 格式的图片');

      const filePath = path.resolve(file.path);
      let size = Number(file.size) || 0;
      if (!size) {
        try {
          size = fs.statSync(filePath).size;
        } catch (error) {
          size = 0;
        }
      }
      if (!size) return jsonError(ctx, '图片读取失败，请重新上传');
      if (size > FEEDBACK_MAX_IMAGE_BYTES) return jsonError(ctx, '单张图片不能超过 5MB');
      totalBytes += size;
      if (totalBytes > FEEDBACK_MAX_TOTAL_BYTES) return jsonError(ctx, '图片总大小不能超过 12MB');

      const cid = `feedback-${now}-${index + 1}@timewhisper`;
      attachments.push({
        filename: `feedback-${index + 1}${IMAGE_EXT_BY_MIME[mime]}`,
        content: fs.readFileSync(filePath),
        contentType: mime,
        cid,
        contentDisposition: 'inline',
      });
    }

    const timeText = new Date(now).toLocaleString('zh-CN', {
      timeZone: 'Asia/Shanghai',
      hour12: false,
    });
    const safeSubjectUser = String(user.username || '').replace(/[\r\n]+/g, ' ');
    const transport = mailTransport();
    feedbackCooldowns.set(user.userId, now);

    try {
      await transport.sendMail({
        from: resolveSender(),
        to: recipient,
        replyTo: user.email || undefined,
        subject: `[时语反馈] ${safeSubjectUser} · ${timeText}`,
        text: [
          '收到一条用户反馈',
          '',
          `用户：${user.username}`,
          `邮箱：${user.email || '未填写'}`,
          `用户 ID：${user.userId}`,
          `时间：${timeText}`,
          '',
          '反馈内容：',
          text,
          '',
          `图片数量：${files.length}`,
        ].join('\n'),
        html: buildFeedbackEmail({
          username: user.username,
          email: user.email,
          userId: user.userId,
          text,
          timeText,
          imageCids: attachments.map((attachment) => attachment.cid),
        }),
        attachments,
      });
    } catch (mailError) {
      feedbackCooldowns.delete(user.userId);
      throw mailError;
    }

    console.log('[TimeWhisperAuth] feedback sent:', user.userId, `${files.length} image(s)`);
    ctx.body = { message: '反馈已发送，感谢你的反馈', cc: 0 };
  } catch (error) {
    console.error('[TimeWhisperAuth] feedback failed:', error.message);
    if (!ctx.body) jsonError(ctx, '反馈发送失败，请稍后重试', 500);
  } finally {
    removeUploadedFiles(files);
  }
});

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
    const expiresInMinutes = Math.round(CODE_TTL_MS / 60000);
    try {
      await transport.sendMail({
        from,
        to: email,
        subject: '时语 TimeWhisper 邮箱验证码',
        text: [
          `你的时语注册验证码是：${code}`,
          '',
          `验证码 ${expiresInMinutes} 分钟内有效，请勿泄露给他人。`,
          '如果这不是你本人的操作，请忽略此邮件。',
        ].join('\n'),
        html: buildVerificationCodeEmail({ code, email, expiresInMinutes }),
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

    const capsules = await DB.find(CAPSULE_COLLECTION, { userId: payload.userId });
    await DB.remove(CAPSULE_COLLECTION, { userId: payload.userId });
    removeCapsuleVoiceFiles(capsules);
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

