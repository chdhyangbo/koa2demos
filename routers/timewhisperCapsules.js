const Router = require('koa-router');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const DB = require('../db/index.js');
const { isAllowedOrigin } = require('../utils/origin');

const router = new Router({ prefix: '/api/timewhisper' });
const CAPSULE_COLLECTION = 'timewhisperCapsules';
const USER_COLLECTION = 'user';
const JWT_SECRET = process.env.JWT_SECRET || 'ybadmin';

const MAX_TEXT_LENGTH = 500;
const MAX_TAG_LENGTH = 30;
const MAX_PASSWORD_QUESTION = 100;
const MAX_PASSWORD_ANSWER = 100;
const MAX_VOICE_SECONDS = 30;
const MAX_VOICE_BYTES = 5 * 1024 * 1024;
const VOICE_URL_PREFIX = '/timewhisper/voice';
const VOICE_DIR = path.join(__dirname, '../static/timewhisper/voice');
const MAX_IMAGES = 3;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_TOTAL_BYTES = 12 * 1024 * 1024;
const IMAGE_URL_PREFIX = '/timewhisper/images';
const IMAGE_DIR = path.join(__dirname, '../static/timewhisper/images');
const MIN_REPLY_TEXT_LENGTH = 5;
const RESPONSE_TIME_LIMIT_MS = 24 * 60 * 60 * 1000;

const AUDIO_MIME_BY_EXT = {
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.webm': 'audio/webm',
  '.amr': 'audio/amr',
  '.3gp': 'audio/3gpp',
};
const AUDIO_EXT_BY_MIME = {
  'audio/mpeg': '.mp3',
  'audio/mp3': '.mp3',
  'audio/mp4': '.m4a',
  'audio/x-m4a': '.m4a',
  'audio/aac': '.aac',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/ogg': '.ogg',
  'audio/webm': '.webm',
  'audio/amr': '.amr',
  'audio/3gpp': '.3gp',
};

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

const LEVEL_TABLE = [
  { level: 1, title: '时间婴儿', unlockExp: 0, privilege: '基础功能' },
  { level: 2, title: '初啼者', unlockExp: 100, privilege: '可发语音60s' },
  { level: 3, title: '邮差学徒', unlockExp: 250, privilege: '解锁盲盒模式' },
  { level: 4, title: '守时人', unlockExp: 500, privilege: '解锁自定义时间标签' },
  { level: 5, title: '记忆收藏家', unlockExp: 900, privilege: '解锁时空密码功能' },
  { level: 6, title: '时间行者', unlockExp: 1500, privilege: '解锁胶囊背景皮肤' },
  { level: 7, title: '时空旅者', unlockExp: 2400, privilege: '解锁时间守护者' },
  { level: 8, title: '命运编织者', unlockExp: 3800, privilege: '解锁批量投递' },
  { level: 9, title: '时间领主', unlockExp: 6000, privilege: '解锁平行宇宙' },
  { level: 10, title: '永恒观测者', unlockExp: 10000, privilege: '专属称号+全部功能' },
];

fs.mkdirSync(VOICE_DIR, { recursive: true });
fs.mkdirSync(IMAGE_DIR, { recursive: true });

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

function enforceTimeWhisperOrigin(ctx) {
  return isAllowedOrigin(ctx);
}

function bodyValue(ctx, key) {
  const value = ctx.request.body ? ctx.request.body[key] : undefined;
  return Array.isArray(value) ? value[0] : value;
}

function bodyString(ctx, key) {
  const value = bodyValue(ctx, key);
  return value == null ? '' : String(value);
}

function bodyBoolean(ctx, key) {
  const value = bodyValue(ctx, key);
  return value === true || value === 'true' || value === '1' || value === 1;
}

function getVoiceFile(ctx) {
  const raw = ctx.request.files && ctx.request.files.voice;
  if (!raw) return null;
  return (Array.isArray(raw) ? raw[0] : raw) || null;
}

function detectAudioMime(file) {
  const declared = String(file.type || file.mimetype || '').toLowerCase();
  if (AUDIO_EXT_BY_MIME[declared]) return declared;
  const extension = path.extname(String(file.name || file.originalFilename || file.path || '')).toLowerCase();
  return AUDIO_MIME_BY_EXT[extension] || '';
}

function resolveAudioExtension(file, mime) {
  const extension = path.extname(String(file.name || file.originalFilename || file.path || '')).toLowerCase();
  if (AUDIO_MIME_BY_EXT[extension]) return extension;
  return AUDIO_EXT_BY_MIME[mime] || '.m4a';
}

function removeFile(filePath) {
  if (!filePath) return;
  try {
    fs.unlinkSync(filePath);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn('[TimeWhisperCapsules] failed to remove file:', error.message);
    }
  }
}

function removeRawVoice(file) {
  if (!file || !file.path) return;
  removeFile(path.resolve(file.path));
}

function persistVoice(file) {
  if (!file || !file.path) return null;

  const mime = detectAudioMime(file);
  if (!mime) throw new ApiError('语音仅支持 MP3、M4A、AAC、WAV、OGG、WebM、AMR 或 3GP 格式');

  const sourcePath = path.resolve(file.path);
  let size = Number(file.size) || 0;
  if (!size) {
    try {
      size = fs.statSync(sourcePath).size;
    } catch (error) {
      size = 0;
    }
  }
  if (!size) throw new ApiError('语音文件读取失败，请重新录制');
  if (size > MAX_VOICE_BYTES) throw new ApiError('语音文件不能超过 5MB');

  const fileName = `voice-${Date.now()}-${crypto.randomBytes(6).toString('hex')}${resolveAudioExtension(file, mime)}`;
  const targetPath = path.join(VOICE_DIR, fileName);

  try {
    fs.renameSync(sourcePath, targetPath);
  } catch (error) {
    if (error.code !== 'EXDEV') throw error;
    fs.copyFileSync(sourcePath, targetPath);
    removeFile(sourcePath);
  }

  return {
    url: `${VOICE_URL_PREFIX}/${fileName}`,
    path: targetPath,
    size,
    mime,
  };
}

function getImageFiles(ctx) {
  const raw = ctx.request.files && ctx.request.files.images;
  if (!raw) return [];
  return (Array.isArray(raw) ? raw : [raw]).filter((file) => file && file.path);
}

function detectImageMime(file) {
  const declared = String(file.type || file.mimetype || '').toLowerCase();
  if (IMAGE_EXT_BY_MIME[declared]) return declared;
  const extension = path.extname(String(file.name || file.originalFilename || file.path || '')).toLowerCase();
  return IMAGE_MIME_BY_EXT[extension] || '';
}

function resolveImageExtension(file, mime) {
  const extension = path.extname(String(file.name || file.originalFilename || file.path || '')).toLowerCase();
  if (IMAGE_MIME_BY_EXT[extension]) return extension;
  return IMAGE_EXT_BY_MIME[mime] || '.jpg';
}

function removeRawImages(files) {
  for (const file of files || []) removeRawVoice(file);
}

function persistImages(files) {
  if (!files || !files.length) return [];
  if (files.length > MAX_IMAGES) throw new ApiError(`最多只能附上 ${MAX_IMAGES} 张图片`);

  const persisted = [];
  let totalBytes = 0;
  try {
    for (const file of files) {
      const mime = detectImageMime(file);
      if (!mime) throw new ApiError('图片仅支持 JPG、PNG、WebP 或 GIF 格式');

      const sourcePath = path.resolve(file.path);
      let size = Number(file.size) || 0;
      if (!size) {
        try {
          size = fs.statSync(sourcePath).size;
        } catch (error) {
          size = 0;
        }
      }
      if (!size) throw new ApiError('图片文件读取失败，请重新选择');
      if (size > MAX_IMAGE_BYTES) throw new ApiError('单张图片不能超过 5MB');

      totalBytes += size;
      if (totalBytes > MAX_IMAGE_TOTAL_BYTES) throw new ApiError('图片总大小不能超过 12MB');

      const fileName = `image-${Date.now()}-${crypto.randomBytes(6).toString('hex')}${resolveImageExtension(file, mime)}`;
      const targetPath = path.join(IMAGE_DIR, fileName);

      try {
        fs.renameSync(sourcePath, targetPath);
      } catch (error) {
        if (error.code !== 'EXDEV') throw error;
        fs.copyFileSync(sourcePath, targetPath);
        removeFile(sourcePath);
      }

      persisted.push({
        url: `${IMAGE_URL_PREFIX}/${fileName}`,
        path: targetPath,
        size,
        mime,
      });
    }
    return persisted;
  } catch (error) {
    for (const item of persisted) removeFile(item.path);
    throw error;
  }
}

function parseVoiceDuration(ctx) {
  const raw = Number(bodyValue(ctx, 'voiceDuration') || bodyValue(ctx, 'duration') || 0);
  if (!Number.isFinite(raw) || raw < 0) return 0;
  const seconds = Math.ceil(raw);
  if (seconds > MAX_VOICE_SECONDS) {
    throw new ApiError(`语音时长不能超过 ${MAX_VOICE_SECONDS} 秒`);
  }
  return seconds;
}

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
    console.error('[TimeWhisperCapsules] auth failed:', error.message);
    jsonError(ctx, '登录状态校验失败，请稍后重试', 500);
    return null;
  }
}

function toTimestamp(value) {
  if (value instanceof Date) return value.getTime();
  const time = Number(value);
  return Number.isFinite(time) ? time : 0;
}

function normalizeCapsule(capsule, now = Date.now()) {
  const openAt = toTimestamp(capsule.openAt);
  const hasResponse = !!capsule.response && !!(capsule.response.text || capsule.response.voiceUrl);
  let status = 'opened';
  if (hasResponse) status = 'responded';
  else if (openAt > now) status = 'sealed';

  const content = status === 'sealed'
    ? {}
    : {
        text: capsule.content && capsule.content.text ? capsule.content.text : '',
        voiceUrl: capsule.content && capsule.content.voiceUrl ? capsule.content.voiceUrl : '',
        voiceDuration: Number(capsule.content && capsule.content.voiceDuration) || 0,
        images: capsule.content && Array.isArray(capsule.content.images)
          ? capsule.content.images.filter(Boolean)
          : [],
      };

  const result = {
    id: capsule.id,
    createdAt: toTimestamp(capsule.createdAt),
    openAt,
    status,
    tag: capsule.tag || '',
    content,
    isBlind: !!capsule.isBlind,
    hasPassword: !!(capsule.password && capsule.password.question),
    password: capsule.password && capsule.password.question
      ? { q: capsule.password.question }
      : null,
  };

  if (capsule.openedAt) result.openedAt = toTimestamp(capsule.openedAt);

  if (hasResponse) {
    result.response = {
      text: capsule.response.text || '',
      voiceUrl: capsule.response.voiceUrl || '',
      voiceDuration: Number(capsule.response.voiceDuration) || 0,
      createdAt: toTimestamp(capsule.response.createdAt),
      autoResponded: !!capsule.response.autoResponded,
    };
  }

  return result;
}

async function findUserCapsules(userId) {
  const list = await DB.find(CAPSULE_COLLECTION, { userId });
  return (list || []).sort((a, b) => toTimestamp(b.createdAt) - toTimestamp(a.createdAt));
}

async function findUserCapsule(userId, id) {
  const list = await DB.find(CAPSULE_COLLECTION, { userId, id });
  return (list && list[0]) || null;
}

function dateKey(timestamp) {
  return new Date(timestamp + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function dayNumber(key) {
  const [year, month, day] = key.split('-').map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86400000);
}

function activityDateKeys(capsules) {
  const days = new Set();
  capsules.forEach((capsule) => {
    const createdAt = toTimestamp(capsule.createdAt);
    if (createdAt) days.add(dateKey(createdAt));
    const respondedAt = capsule.response ? toTimestamp(capsule.response.createdAt) : 0;
    if (respondedAt) days.add(dateKey(respondedAt));
  });
  return days;
}

function computeStreak(days, now) {
  if (!days.size) return { streak: 0, maxStreak: 0 };
  const numbers = Array.from(days).map(dayNumber).sort((a, b) => a - b);
  let maxStreak = 1;
  let running = 1;
  for (let index = 1; index < numbers.length; index += 1) {
    if (numbers[index] === numbers[index - 1] + 1) {
      running += 1;
    } else {
      running = 1;
    }
    if (running > maxStreak) maxStreak = running;
  }

  const today = dayNumber(dateKey(now));
  const last = numbers[numbers.length - 1];
  let streak = 0;
  if (last === today || last === today - 1) {
    streak = 1;
    for (let index = numbers.length - 1; index > 0; index -= 1) {
      if (numbers[index] === numbers[index - 1] + 1) streak += 1;
      else break;
    }
  }
  return { streak, maxStreak };
}

function levelForExp(exp) {
  let current = LEVEL_TABLE[0];
  for (const item of LEVEL_TABLE) {
    if (exp >= item.unlockExp) current = item;
    else break;
  }
  const next = LEVEL_TABLE.find((item) => item.level === current.level + 1) || null;
  return { current, next };
}

function buildStats(capsules, now = Date.now()) {
  const totalCapsules = capsules.length;
  const responded = capsules.filter((capsule) => capsule.response && (capsule.response.text || capsule.response.voiceUrl)).length;
  const pending = capsules.filter((capsule) => {
    const openAt = toTimestamp(capsule.openAt);
    return !capsule.response && openAt <= now;
  }).length;
  const sealed = capsules.filter((capsule) => {
    const openAt = toTimestamp(capsule.openAt);
    return !capsule.response && openAt > now;
  }).length;
  const blindBoxes = capsules.filter((capsule) => capsule.isBlind).length;
  const passwordCapsules = capsules.filter((capsule) => capsule.password && capsule.password.question).length;
  const voiceCapsules = capsules.filter((capsule) => capsule.content && capsule.content.voiceUrl).length;
  const totalVoiceSeconds = capsules.reduce((total, capsule) => {
    return total
      + (Number(capsule.content && capsule.content.voiceDuration) || 0)
      + (Number(capsule.response && capsule.response.voiceDuration) || 0);
  }, 0);
  const imageCapsules = capsules.filter((capsule) => {
    return !!(capsule.content && Array.isArray(capsule.content.images) && capsule.content.images.length);
  }).length;
  const tags = new Set(
    capsules
      .map((capsule) => String(capsule.tag || '').trim())
      .filter(Boolean)
  );
  const fastReplies = capsules.filter((capsule) => {
    if (!capsule.response) return false;
    const openedAt = toTimestamp(capsule.openedAt) || toTimestamp(capsule.openAt);
    const repliedAt = toTimestamp(capsule.response.createdAt);
    return openedAt > 0 && repliedAt >= openedAt && repliedAt - openedAt <= 60 * 60 * 1000;
  }).length;
  const totalWaitMs = capsules.reduce((total, capsule) => {
    return total + Math.max(0, toTimestamp(capsule.openAt) - toTimestamp(capsule.createdAt));
  }, 0);
  const totalWaitYears = Math.floor((totalWaitMs / (365 * 86400000)) * 10) / 10;

  const days = activityDateKeys(capsules);
  const { streak, maxStreak } = computeStreak(days, now);
  const lastDay = Array.from(days).map(dayNumber).sort((a, b) => a - b).pop();
  const idleDays = lastDay ? Math.max(0, dayNumber(dateKey(now)) - lastDay) : 0;
  const integrity = Math.max(0, 100 - Math.min(20, Math.max(0, idleDays - 3) * 5));

  const exp = totalCapsules * 30
    + responded * 50
    + blindBoxes * 15
    + passwordCapsules * 10
    + days.size * 10;
  const { current, next } = levelForExp(exp);
  const progress = next
    ? Math.min(100, Math.max(0, Math.round(((exp - current.unlockExp) / (next.unlockExp - current.unlockExp)) * 100)))
    : 100;

  const nightOwl = capsules.some((capsule) => {
    const hour = new Date(toTimestamp(capsule.createdAt) + 8 * 60 * 60 * 1000).getUTCHours();
    return hour >= 0 && hour < 4;
  });
  const earlyBird = capsules.some((capsule) => {
    const hour = new Date(toTimestamp(capsule.createdAt) + 8 * 60 * 60 * 1000).getUTCHours();
    return hour >= 5 && hour < 7;
  });
  const tenYear = capsules.some((capsule) => {
    return toTimestamp(capsule.openAt) - toTimestamp(capsule.createdAt) >= 10 * 365 * 86400000;
  });
  const hiddenEcho = capsules.some((capsule) => capsule.isBlind && !!capsule.response);
  const level = current.level;
  const totalFractures = 0;
  const totalRepairs = 0;

  const badgeState = (id, progress, target, unlocked) => ({
    id,
    progress: Math.max(0, Math.min(Number(progress) || 0, target)),
    target,
    unlocked: typeof unlocked === 'boolean' ? unlocked : (Number(progress) || 0) >= target,
  });
  const badges = [
    badgeState('first_capsule', totalCapsules, 1),
    badgeState('ten_capsules', totalCapsules, 10),
    badgeState('voice_keeper', voiceCapsules, 3),
    badgeState('image_memory', imageCapsules, 3),
    badgeState('night_owl', nightOwl ? 1 : 0, 1),
    badgeState('early_bird', earlyBird ? 1 : 0, 1),
    badgeState('secret_keeper', passwordCapsules, 1),
    badgeState('gambler', blindBoxes, 1),
    badgeState('first_reply', responded, 1),
    badgeState('streak_3', maxStreak, 3),
    badgeState('streak_7', maxStreak, 7),
    badgeState('tag_master', tags.size, 5),
    badgeState('speed_reply', fastReplies, 3),
    badgeState('ten_year', tenYear ? 1 : 0, 1),
    badgeState('star_post', totalWaitYears, 100),
    badgeState('streak_30', maxStreak, 30),
    badgeState('hidden_echo', hiddenEcho ? 1 : 0, 1),
    badgeState('time_lord', level, 9),
    badgeState('perfect_year', maxStreak, 365),
    badgeState('eternal', maxStreak, 365, level >= 10 && maxStreak >= 365),
  ];
  const unlockedBadges = badges.filter((badge) => badge.unlocked).map((badge) => badge.id);

  return {
    stats: {
      sent: totalCapsules,
      total: totalCapsules,
      received: responded + pending,
      responded,
      pending,
      sealed,
      rate: responded + pending > 0 ? Math.round((responded / (responded + pending)) * 100) : 0,
      blindBoxes,
      passwordCapsules,
      voiceCapsules,
      totalVoiceSeconds,
    },
    game: {
      level,
      exp,
      streak,
      maxStreak,
      integrity,
      totalCapsules,
      totalResponses: responded,
      totalFractures,
      totalRepairs,
      unlockedBadges,
      lastStreakDate: days.size ? Array.from(days).sort().pop() : '',
    },
    level: {
      current,
      next,
      progress,
    },
    badges,
    generatedAt: now,
  };
}

function settingsFor(user) {
  const saved = user.timewhisperSettings || {};
  return {
    sound: saved.sound !== false,
    vibrate: saved.vibrate !== false,
    dark: saved.dark !== false,
  };
}

function validateCreateBody(ctx) {
  const text = bodyString(ctx, 'text').trim();
  const tag = bodyString(ctx, 'tag').trim();
  const question = bodyString(ctx, 'passwordQuestion').trim();
  const answer = bodyString(ctx, 'passwordAnswer').trim();

  if (text.length > MAX_TEXT_LENGTH) throw new ApiError(`文字内容不能超过 ${MAX_TEXT_LENGTH} 字`);
  if (tag.length > MAX_TAG_LENGTH) throw new ApiError(`标签不能超过 ${MAX_TAG_LENGTH} 个字符`);
  if (question.length > MAX_PASSWORD_QUESTION) throw new ApiError('密码问题不能超过 100 个字符');
  if (answer.length > MAX_PASSWORD_ANSWER) throw new ApiError('密码答案不能超过 100 个字符');
  if ((question && !answer) || (!question && answer)) {
    throw new ApiError('请同时填写时空密码的问题和答案');
  }

  return { text, tag, question, answer };
}

router.get('/capsules', async (ctx) => {
  if (!enforceTimeWhisperOrigin(ctx)) return jsonError(ctx, '来源未获允许', 403);
  try {
    const user = await authenticateRequest(ctx);
    if (!user) return;
    const userId = user.userId || user._id.toString();
    const capsules = await findUserCapsules(userId);
    const now = Date.now();
    ctx.body = {
      cc: 0,
      capsules: capsules.map((capsule) => normalizeCapsule(capsule, now)),
      updatedAt: now,
    };
  } catch (error) {
    console.error('[TimeWhisperCapsules] list failed:', error.message);
    jsonError(ctx, '胶囊列表加载失败，请稍后重试', 500);
  }
});

router.get('/capsules/:id', async (ctx) => {
  if (!enforceTimeWhisperOrigin(ctx)) return jsonError(ctx, '来源未获允许', 403);
  try {
    const user = await authenticateRequest(ctx);
    if (!user) return;
    const userId = user.userId || user._id.toString();
    const capsule = await findUserCapsule(userId, ctx.params.id);
    if (!capsule) return jsonError(ctx, '胶囊不存在', 404);

    const now = Date.now();
    if (!capsule.openedAt && toTimestamp(capsule.openAt) <= now) {
      capsule.openedAt = now;
      await DB.update(CAPSULE_COLLECTION, { _id: DB.getObjectId(capsule._id.toString()) }, { openedAt: now });
    }

    ctx.body = { cc: 0, capsule: normalizeCapsule(capsule, now) };
  } catch (error) {
    console.error('[TimeWhisperCapsules] detail failed:', error.message);
    jsonError(ctx, '胶囊加载失败，请稍后重试', 500);
  }
});

router.post('/capsules', async (ctx) => {
  if (!enforceTimeWhisperOrigin(ctx)) return jsonError(ctx, '来源未获允许', 403);
  const voiceFile = getVoiceFile(ctx);
  const imageFiles = getImageFiles(ctx);
  let persisted = null;
  let persistedImages = [];
  try {
    const user = await authenticateRequest(ctx);
    if (!user) {
      removeRawVoice(voiceFile);
      removeRawImages(imageFiles);
      return;
    }

    const { text, tag, question, answer } = validateCreateBody(ctx);
    const voiceDuration = parseVoiceDuration(ctx);
    const isBlind = bodyBoolean(ctx, 'isBlind');
    const requestedOpenAt = Number(bodyValue(ctx, 'openAt') || 0);
    const openAt = isBlind
      ? Date.now() + (30 + Math.floor(Math.random() * 335)) * 86400000
      : requestedOpenAt;

    if (!voiceFile && !text && !imageFiles.length) {
      ctx.status = 400;
      ctx.body = { message: '请输入文字、录制语音或添加图片', cc: 1 };
      return;
    }
    if (imageFiles.length > MAX_IMAGES) throw new ApiError(`最多只能附上 ${MAX_IMAGES} 张图片`);
    if (!Number.isFinite(openAt) || openAt <= 0) throw new ApiError('请选择有效的开启时间');

    persisted = persistVoice(voiceFile);
    persistedImages = persistImages(imageFiles);
    const now = Date.now();
    const userId = user.userId || user._id.toString();
    const capsule = {
      id: `c-${now}-${crypto.randomBytes(5).toString('hex')}`,
      userId,
      createdAt: now,
      openAt,
      status: 'sealed',
      tag,
      content: {
        text,
        voiceUrl: persisted ? persisted.url : '',
        voiceDuration: persisted ? voiceDuration : 0,
        images: persistedImages.map((image) => image.url),
      },
      isBlind,
      password: question
        ? { question, answerHash: hashSecret(answer), failedAttempts: 0, lockedUntil: 0 }
        : null,
      openedAt: 0,
      response: null,
    };

    await DB.insert(CAPSULE_COLLECTION, capsule);
    ctx.body = { cc: 0, capsule: normalizeCapsule(capsule, now) };
  } catch (error) {
    if (persisted) removeFile(persisted.path);
    else removeRawVoice(voiceFile);
    for (const image of persistedImages) removeFile(image.path);
    removeRawImages(imageFiles);
    console.error('[TimeWhisperCapsules] create failed:', error.message);
    if (error instanceof ApiError) {
      jsonError(ctx, error.message, error.status);
    } else if (!ctx.body) {
      jsonError(ctx, '胶囊发射失败，请稍后重试', 500);
    }
  }
});

router.post('/capsules/:id/unlock', async (ctx) => {
  if (!enforceTimeWhisperOrigin(ctx)) return jsonError(ctx, '来源未获允许', 403);
  try {
    const user = await authenticateRequest(ctx);
    if (!user) return;
    const userId = user.userId || user._id.toString();
    const capsule = await findUserCapsule(userId, ctx.params.id);
    if (!capsule) return jsonError(ctx, '胶囊不存在', 404);
    if (toTimestamp(capsule.openAt) > Date.now()) return jsonError(ctx, '胶囊仍在封印中', 409);
    if (!capsule.password || !capsule.password.question) {
      ctx.body = { cc: 0, unlocked: true };
      return;
    }
    const now = Date.now();
    const failedAttempts = Number(capsule.password.failedAttempts) || 0;
    const lockedUntil = Number(capsule.password.lockedUntil) || 0;
    if (lockedUntil > now) {
      return jsonError(ctx, '答案错误次数过多，请 1 小时后再试', 429);
    }

    const answer = bodyString(ctx, 'answer').trim();
    if (!answer) return jsonError(ctx, '请输入时空密码答案');
    if (!checkSecret(answer, capsule.password.answerHash)) {
      const nextAttempts = failedAttempts + 1;
      if (nextAttempts >= 3) {
        capsule.password.failedAttempts = 0;
        capsule.password.lockedUntil = now + 60 * 60 * 1000;
        await DB.update(CAPSULE_COLLECTION, { _id: DB.getObjectId(capsule._id.toString()) }, {
          password: capsule.password,
        });
        return jsonError(ctx, '答案错误次数过多，请 1 小时后再试', 429);
      }
      capsule.password.failedAttempts = nextAttempts;
      capsule.password.lockedUntil = 0;
      await DB.update(CAPSULE_COLLECTION, { _id: DB.getObjectId(capsule._id.toString()) }, {
        password: capsule.password,
      });
      return jsonError(ctx, `答案错误，还可尝试 ${3 - nextAttempts} 次`, 403);
    }

    if (failedAttempts || lockedUntil) {
      capsule.password.failedAttempts = 0;
      capsule.password.lockedUntil = 0;
      await DB.update(CAPSULE_COLLECTION, { _id: DB.getObjectId(capsule._id.toString()) }, {
        password: capsule.password,
      });
    }
    ctx.body = { cc: 0, unlocked: true };
  } catch (error) {
    console.error('[TimeWhisperCapsules] unlock failed:', error.message);
    jsonError(ctx, '密码验证失败，请稍后重试', 500);
  }
});

router.post('/capsules/:id/reply', async (ctx) => {
  if (!enforceTimeWhisperOrigin(ctx)) return jsonError(ctx, '来源未获允许', 403);
  const voiceFile = getVoiceFile(ctx);
  let persisted = null;
  try {
    const user = await authenticateRequest(ctx);
    if (!user) return;
    const userId = user.userId || user._id.toString();
    const capsule = await findUserCapsule(userId, ctx.params.id);
    if (!capsule) return jsonError(ctx, '胶囊不存在', 404);

    const now = Date.now();
    if (toTimestamp(capsule.openAt) > now) return jsonError(ctx, '胶囊仍在封印中', 409);
    if (capsule.response && (capsule.response.text || capsule.response.voiceUrl)) {
      return jsonError(ctx, '这个胶囊已经回信了', 409);
    }

    const text = bodyString(ctx, 'text').trim();
    if (text.length > MAX_TEXT_LENGTH) throw new ApiError(`回信内容不能超过 ${MAX_TEXT_LENGTH} 字`);
    if (!voiceFile && text.length < MIN_REPLY_TEXT_LENGTH) {
      return jsonError(ctx, `请输入至少 ${MIN_REPLY_TEXT_LENGTH} 个字的回信或录制语音`);
    }
    const voiceDuration = parseVoiceDuration(ctx);
    persisted = persistVoice(voiceFile);

    const response = {
      text,
      voiceUrl: persisted ? persisted.url : '',
      voiceDuration: persisted ? voiceDuration : 0,
      createdAt: now,
      autoResponded: bodyBoolean(ctx, 'autoResponded'),
    };
    const openedAt = capsule.openedAt || now;

    await DB.update(CAPSULE_COLLECTION, { _id: DB.getObjectId(capsule._id.toString()) }, {
      status: 'responded',
      openedAt,
      response,
    });

    capsule.status = 'responded';
    capsule.openedAt = openedAt;
    capsule.response = response;
    ctx.body = { cc: 0, capsule: normalizeCapsule(capsule, now) };
  } catch (error) {
    if (persisted) removeFile(persisted.path);
    else removeRawVoice(voiceFile);
    console.error('[TimeWhisperCapsules] reply failed:', error.message);
    if (error instanceof ApiError) {
      jsonError(ctx, error.message, error.status);
    } else if (!ctx.body) {
      jsonError(ctx, '回信发送失败，请稍后重试', 500);
    }
  }
});

router.get('/achievements', async (ctx) => {
  if (!enforceTimeWhisperOrigin(ctx)) return jsonError(ctx, '来源未获允许', 403);
  try {
    const user = await authenticateRequest(ctx);
    if (!user) return;
    const userId = user.userId || user._id.toString();
    const capsules = await findUserCapsules(userId);
    const result = buildStats(capsules);
    ctx.body = {
      cc: 0,
      userId,
      stats: result.stats,
      game: result.game,
      level: result.level,
      unlockedBadges: result.game.unlockedBadges,
      badges: result.badges,
      generatedAt: result.generatedAt,
    };
  } catch (error) {
    console.error('[TimeWhisperCapsules] achievements failed:', error.message);
    jsonError(ctx, '成就数据加载失败，请稍后重试', 500);
  }
});

router.post('/profile', async (ctx) => {
  if (!enforceTimeWhisperOrigin(ctx)) return jsonError(ctx, '来源未获允许', 403);
  try {
    const user = await authenticateRequest(ctx);
    if (!user) return;
    const username = String(ctx.request.body?.username || '').trim();
    if (username.length < 2 || username.length > 40) throw new ApiError('用户名长度需为 2-40 个字符');
    if (/[\s<>]/.test(username)) throw new ApiError('用户名不能包含空格或 < > 字符');
    if (username === user.username) {
      ctx.body = {
        cc: 0,
        message: '用户名未变更',
        userId: user.userId || user._id.toString(),
        username: user.username,
        email: user.email || '',
      };
      return;
    }
    const matches = await DB.find(USER_COLLECTION, { username });
    const occupied = (matches || []).some((item) => item._id.toString() !== user._id.toString());
    if (occupied) return jsonError(ctx, '该用户名已被使用', 409);

    await DB.update(USER_COLLECTION, { _id: user._id }, { username });
    ctx.body = {
      cc: 0,
      message: '用户名已更新',
      userId: user.userId || user._id.toString(),
      username,
      email: user.email || '',
    };
  } catch (error) {
    console.error('[TimeWhisperCapsules] profile update failed:', error.message);
    if (error instanceof ApiError) {
      jsonError(ctx, error.message, error.status);
    } else {
      jsonError(ctx, '用户名更新失败，请稍后重试', 500);
    }
  }
});

router.get('/settings', async (ctx) => {
  if (!enforceTimeWhisperOrigin(ctx)) return jsonError(ctx, '来源未获允许', 403);
  try {
    const user = await authenticateRequest(ctx);
    if (!user) return;
    const userId = user.userId || user._id.toString();
    const capsules = await findUserCapsules(userId);
    const result = buildStats(capsules);
    ctx.body = {
      cc: 0,
      profile: {
        userId,
        username: user.username,
        email: user.email || '',
      },
      summary: {
        total: result.stats.total,
        responded: result.stats.responded,
        pending: result.stats.pending,
        sealed: result.stats.sealed,
        maxStreak: result.game.maxStreak,
      },
      game: result.game,
      level: result.level,
      preferences: settingsFor(user),
      responseTimeLimitMs: RESPONSE_TIME_LIMIT_MS,
      generatedAt: result.generatedAt,
    };
  } catch (error) {
    console.error('[TimeWhisperCapsules] settings failed:', error.message);
    jsonError(ctx, '设置数据加载失败，请稍后重试', 500);
  }
});

module.exports = router;
