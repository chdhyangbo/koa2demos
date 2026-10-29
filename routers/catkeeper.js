const Router = require('koa-router')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const jwt = require('jsonwebtoken')
const nodemailer = require('nodemailer')
const DB = require('../db/index.js')
const { isAllowedOrigin } = require('../utils/origin')

const router = new Router({ prefix: '/api/catkeeper' })

const USER_COLLECTION = 'catkeeperUsers'
const CODE_COLLECTION = 'catkeeperEmailCodes'
const ITEM_COLLECTION = 'catkeeperItems'
const FEEDBACK_COLLECTION = 'catkeeperFeedback'
const JWT_SECRET = process.env.JWT_SECRET || 'ybadmin'
const CODE_TTL_MS = 10 * 60 * 1000
const CODE_RESEND_MS = 60 * 1000
const MAX_CODE_ATTEMPTS = 5
const MAX_ITEM_IMAGE_BYTES = 8 * 1024 * 1024
const MAX_FEEDBACK_IMAGES = 3
const MAX_FEEDBACK_IMAGE_BYTES = 5 * 1024 * 1024
const PROFILE_GENDERS = new Set(['male', 'female', 'secret'])
const MAX_PROFILE_DESCRIPTION_LENGTH = 120
const IMAGE_DIR = path.join(__dirname, '../static/catkeeper/images')
const IMAGE_URL_PREFIX = '/catkeeper/images'

const IMAGE_MIME_BY_EXT = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif'
}
const IMAGE_EXT_BY_MIME = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif'
}

fs.mkdirSync(IMAGE_DIR, { recursive: true })

let schemaPromise = null
function ensureSchema() {
  if (!schemaPromise) {
    schemaPromise = DB.connect()
      .then(async (db) => {
        await db.collection(USER_COLLECTION).createIndex({ userId: 1 }, { unique: true, name: 'uniq_userId' })
        await db.collection(USER_COLLECTION).createIndex({ email: 1 }, { name: 'email_lookup' })
        await db.collection(CODE_COLLECTION).createIndex({ email: 1 }, { name: 'email_lookup' })
        const itemIndexes = await db.collection(ITEM_COLLECTION).indexes()
        const legacyItemIndex = itemIndexes.find((index) => index.name === 'uniq_itemId' && !index.key?.id)
        if (legacyItemIndex) {
          await db.collection(ITEM_COLLECTION).dropIndex('uniq_itemId')
        }
        await db.collection(ITEM_COLLECTION).createIndex({ id: 1 }, { unique: true, name: 'uniq_itemId' })
        await db.collection(ITEM_COLLECTION).createIndex({ userId: 1, discardedAt: 1, expiresOn: 1 }, { name: 'user_items' })
        await db.collection(FEEDBACK_COLLECTION).createIndex({ userId: 1, createdAt: -1 }, { name: 'user_feedback' })
      })
      .catch((error) => {
        schemaPromise = null
        console.error('[catkeeper] schema init failed:', error.message)
      })
  }
  return schemaPromise
}
ensureSchema()

function enforceOrigin(ctx) {
  return isAllowedOrigin(ctx)
}

function jsonError(ctx, message, status = 400, cc = 1) {
  ctx.status = status
  ctx.body = { message, cc }
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase()
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex')
  return `scrypt$${salt}$${hash}`
}

function checkPassword(received, stored) {
  if (typeof received !== 'string' || typeof stored !== 'string') return false
  if (!stored.startsWith('scrypt$')) return received === stored
  const [, salt, expectedHex] = stored.split('$')
  if (!salt || !expectedHex) return false
  const expected = Buffer.from(expectedHex, 'hex')
  const actual = crypto.scryptSync(received, salt, expected.length)
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected)
}

function mailTransport() {
  const { SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS } = process.env
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    throw new Error('邮件服务未配置，请设置 SMTP_HOST、SMTP_USER 和 SMTP_PASS')
  }
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT || 587),
    secure: SMTP_SECURE === 'true',
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  })
}

function extractAddress(value) {
  const match = String(value || '').match(/<([^>]+)>|([^\s<>]+@[^\s<>]+)/)
  return match ? (match[1] || match[2]).trim() : ''
}

function resolveSender() {
  const authUser = String(process.env.SMTP_USER || '').trim()
  const configured = String(process.env.CATKEEPER_SMTP_FROM || process.env.SMTP_FROM || '').trim()
  if (!configured) return authUser
  const address = extractAddress(configured)
  if (!address || address.toLowerCase() === authUser.toLowerCase()) return configured
  const nameMatch = configured.match(/^([^<]*)</)
  const name = nameMatch ? nameMatch[1].trim().replace(/^"(.*)"$/, '$1') : ''
  return name ? { name, address: authUser } : authUser
}

function buildCodeEmail({ code, expiresInMinutes }) {
  return `
  <div style="margin:0;padding:36px 18px;background:#faf4e9;font-family:'PingFang SC','Microsoft YaHei',sans-serif;">
    <div style="max-width:520px;margin:0 auto;background:#fffdf9;border:1px solid #eadcc8;border-radius:24px;padding:34px 30px;color:#3f332a;">
      <div style="font-size:13px;letter-spacing:3px;color:#d9825b;">MEOWKEEPER</div>
      <h1 style="margin:12px 0 8px;font-size:24px;font-weight:600;color:#3f332a;">猫猫管理员 · 注册验证码</h1>
      <p style="margin:0 0 24px;font-size:14px;line-height:1.8;color:#6b5a4b;">
        猫咪正在帮你确认账号归属，请输入下面的验证码完成注册。
      </p>
      <div style="margin:0 0 24px;padding:22px;text-align:center;font-size:34px;letter-spacing:12px;font-weight:700;color:#c26b46;background:#f7e3d6;border-radius:16px;">
        ${code}
      </div>
      <p style="margin:0;font-size:12px;line-height:1.8;color:#a08d7b;">
        验证码 ${expiresInMinutes} 分钟内有效，请勿转发给他人。如果不是你本人操作，请忽略这封邮件。
      </p>
    </div>
  </div>`
}

function bodyValue(ctx, key) {
  const value = ctx.request.body ? ctx.request.body[key] : undefined
  return Array.isArray(value) ? value[0] : value
}

function bodyString(ctx, key) {
  const value = bodyValue(ctx, key)
  return value == null ? '' : String(value)
}

function isValidDateString(value) {
  if (!value) return true
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
}

async function findUserByUsername(username) {
  const users = await DB.find(USER_COLLECTION, { username })
  return users && users[0]
}

async function findUserByEmail(email) {
  const users = await DB.find(USER_COLLECTION, { email })
  return users && users[0]
}

async function authenticateRequest(ctx) {
  const token = ctx.get('token')
  if (!token) {
    jsonError(ctx, '登录状态已失效，请重新登录', 401)
    return null
  }

  let payload
  try {
    payload = jwt.verify(token, JWT_SECRET)
  } catch (error) {
    jsonError(ctx, '登录状态已失效，请重新登录', 401)
    return null
  }
  if (!payload.time || Date.now() - payload.time > payload.timeout) {
    jsonError(ctx, '登录状态已失效，请重新登录', 401)
    return null
  }

  try {
    const users = await DB.find(USER_COLLECTION, { userId: payload.userId, catkeeperAuth: true })
    const user = users && users[0]
    if (!user || !user.emailVerified) {
      jsonError(ctx, '登录状态已失效，请重新登录', 401)
      return null
    }
    return user
  } catch (error) {
    console.error('[CatKeeper] auth failed:', error.message)
    jsonError(ctx, '登录状态校验失败，请稍后再试', 500)
    return null
  }
}

function signToken(user) {
  return jwt.sign({
    userId: user.userId,
    username: user.username,
    email: user.email || '',
    catkeeper: true,
    emailVerified: true,
    time: Date.now(),
    timeout: 1000 * 24 * 60 * 60
  }, JWT_SECRET)
}

function profileFields(user) {
  return {
    gender: user.gender || '',
    description: user.description || ''
  }
}

/* ============================== Auth ============================== */

router.post('/send-email-code', async (ctx) => {
  if (!enforceOrigin(ctx)) return jsonError(ctx, '来源未授权', 403)
  const username = String(ctx.request.body?.username || '').trim()
  const email = normalizeEmail(ctx.request.body?.email)
  if (username.length < 2 || username.length > 40) return jsonError(ctx, '用户名需为 2-40 个字符')
  if (!validEmail(email)) return jsonError(ctx, '请输入有效的邮箱地址')

  let transport
  try {
    transport = mailTransport()
    await transport.verify()
  } catch (error) {
    console.error('[CatKeeper] mail transport unavailable:', error.message)
    return jsonError(ctx, '邮件服务暂时不可用，请稍后再试', 500)
  }

  try {
    const [emailOwner, usernameMatch] = await Promise.all([
      findUserByEmail(email),
      findUserByUsername(username)
    ])

    if (emailOwner && emailOwner.emailVerified) return jsonError(ctx, '该邮箱已注册')
    if (emailOwner && emailOwner.username !== username) return jsonError(ctx, '该邮箱已注册')
    if (usernameMatch && usernameMatch.email !== email) return jsonError(ctx, '该用户名已被使用')

    const now = Date.now()
    const existing = (await DB.find(CODE_COLLECTION, { email, purpose: 'register' }))?.[0]
    if (existing && now - new Date(existing.sentAt).getTime() < CODE_RESEND_MS) {
      return jsonError(ctx, '请稍后再获取验证码')
    }

    const code = crypto.randomInt(0, 1000000).toString().padStart(6, '0')
    const secret = process.env.EMAIL_CODE_SECRET || JWT_SECRET
    const codeHash = crypto.createHmac('sha256', secret).update(`${email}:${code}`).digest('hex')
    const record = {
      email,
      purpose: 'register',
      codeHash,
      sentAt: new Date(now),
      expiresAt: new Date(now + CODE_TTL_MS),
      attempts: 0
    }

    if (existing?._id) {
      await DB.update(CODE_COLLECTION, { _id: DB.getObjectId(existing._id) }, record)
    } else {
      await DB.insert(CODE_COLLECTION, record)
    }

    try {
      await transport.sendMail({
        from: resolveSender(),
        to: email,
        subject: '猫猫管理员 · 注册验证码',
        text: `猫猫管理员注册验证码：${code}（${Math.round(CODE_TTL_MS / 60000)} 分钟内有效）`,
        html: buildCodeEmail({ code, expiresInMinutes: Math.round(CODE_TTL_MS / 60000) })
      })
    } catch (mailError) {
      if (existing?._id) {
        await DB.update(CODE_COLLECTION, { _id: DB.getObjectId(existing._id) }, {
          sentAt: new Date(0),
          codeHash: '',
          expiresAt: new Date(0)
        })
      } else {
        await DB.remove(CODE_COLLECTION, { email, purpose: 'register' })
      }
      throw mailError
    }

    ctx.body = { cc: 0, message: '验证码已发送，请查收邮箱', expiresIn: CODE_TTL_MS / 1000 }
  } catch (error) {
    console.error('[CatKeeper] send email code failed:', error.message)
    jsonError(ctx, '验证码发送失败，请稍后再试', 500)
  }
})

router.post('/register', async (ctx) => {
  if (!enforceOrigin(ctx)) return jsonError(ctx, '来源未授权', 403)
  const username = String(ctx.request.body?.username || '').trim()
  const email = normalizeEmail(ctx.request.body?.email)
  const password = String(ctx.request.body?.password || '')
  const verificationCode = String(ctx.request.body?.verificationCode || '').trim()

  if (username.length < 2 || username.length > 40) return jsonError(ctx, '用户名需为 2-40 个字符')
  if (!validEmail(email)) return jsonError(ctx, '请输入有效的邮箱地址')
  if (password.length < 8 || password.length > 128) return jsonError(ctx, '密码长度需为 8-128 个字符')
  if (!/^\d{6}$/.test(verificationCode)) return jsonError(ctx, '请输入 6 位数字验证码')

  try {
    const codeRecord = (await DB.find(CODE_COLLECTION, { email, purpose: 'register' }))?.[0]
    if (!codeRecord || new Date(codeRecord.expiresAt).getTime() <= Date.now()) {
      return jsonError(ctx, '验证码已过期，请重新获取')
    }
    if ((codeRecord.attempts || 0) >= MAX_CODE_ATTEMPTS) {
      return jsonError(ctx, '验证码错误次数过多，请重新获取')
    }

    const secret = process.env.EMAIL_CODE_SECRET || JWT_SECRET
    const actual = crypto.createHmac('sha256', secret).update(`${email}:${verificationCode}`).digest()
    const expected = Buffer.from(codeRecord.codeHash, 'hex')
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
      await DB.update(CODE_COLLECTION, { _id: DB.getObjectId(codeRecord._id) }, {
        attempts: (codeRecord.attempts || 0) + 1
      })
      return jsonError(ctx, '验证码不正确')
    }

    const [emailOwner, usernameMatch] = await Promise.all([
      findUserByEmail(email),
      findUserByUsername(username)
    ])
    if (emailOwner && emailOwner.username !== username) return jsonError(ctx, '该邮箱已注册')
    if (usernameMatch && usernameMatch.email !== email) return jsonError(ctx, '该用户名已被使用')
    if (emailOwner && usernameMatch && emailOwner._id.toString() !== usernameMatch._id.toString()) {
      return jsonError(ctx, '账号信息冲突，请更换用户名')
    }

    const now = new Date()
    const targetUser = emailOwner || usernameMatch
    const userRecord = {
      username,
      email,
      password: hashPassword(password),
      passwordUpdatedAt: now,
      emailVerified: true,
      emailVerifiedAt: now,
      catkeeperAuth: true,
      fromWay: 'catkeeper',
      gender: targetUser?.gender || '',
      description: targetUser?.description || '',
      createdAt: targetUser?.createdAt ? new Date(targetUser.createdAt) : now
    }

    let userId
    if (targetUser) {
      userId = targetUser.userId || targetUser._id.toString()
      await DB.update(USER_COLLECTION, { _id: DB.getObjectId(targetUser._id) }, { ...userRecord, userId })
    } else {
      const inserted = await DB.insert(USER_COLLECTION, userRecord)
      userId = inserted.insertedId.toString()
      await DB.update(USER_COLLECTION, { _id: DB.getObjectId(userId) }, { userId })
    }
    await DB.remove(CODE_COLLECTION, { _id: DB.getObjectId(codeRecord._id) })

    const user = { userId, username, email, gender: userRecord.gender, description: userRecord.description }
    ctx.body = {
      cc: 0,
      message: '注册成功',
      token: signToken(user),
      userId,
      username,
      email,
      ...profileFields(user)
    }
  } catch (error) {
    console.error('[CatKeeper] registration failed:', error.message)
    jsonError(ctx, '注册失败，请稍后再试', 500)
  }
})

router.post('/login', async (ctx) => {
  if (!enforceOrigin(ctx)) return jsonError(ctx, '来源未授权', 403)
  const username = String(ctx.request.body?.username || '').trim()
  const password = String(ctx.request.body?.password || '')
  if (!username || !password) return jsonError(ctx, '请输入用户名和密码')

  try {
    const user = await findUserByUsername(username)
    if (!user || !user.catkeeperAuth || !checkPassword(password, user.password)) {
      return jsonError(ctx, '用户名或密码不正确', 401)
    }
    if (!user.emailVerified) {
      ctx.status = 403
      ctx.body = {
        cc: 1,
        message: '账号尚未完成邮箱验证，请重新获取验证码',
        emailVerificationRequired: true,
        email: user.email,
        canResend: true
      }
      return
    }
    const userId = user.userId || user._id.toString()
    if (!user.userId) {
      await DB.update(USER_COLLECTION, { _id: DB.getObjectId(user._id) }, { userId })
    }
    ctx.body = {
      cc: 0,
      message: '登录成功',
      token: signToken({ ...user, userId }),
      userId,
      username: user.username,
      email: user.email || '',
      ...profileFields(user)
    }
  } catch (error) {
    console.error('[CatKeeper] login failed:', error.message)
    jsonError(ctx, '登录失败，请稍后再试', 500)
  }
})

router.get('/session', async (ctx) => {
  if (!enforceOrigin(ctx)) return jsonError(ctx, '来源未授权', 403)
  const user = await authenticateRequest(ctx)
  if (!user) return
  ctx.body = {
    cc: 0,
    message: '登录状态有效',
    userId: user.userId || user._id.toString(),
    username: user.username,
    email: user.email || '',
    ...profileFields(user)
  }
})

router.post('/profile', async (ctx) => {
  if (!enforceOrigin(ctx)) return jsonError(ctx, '来源未授权', 403)
  const user = await authenticateRequest(ctx)
  if (!user) return

  const body = ctx.request.body || {}
  const hasField = (key) => Object.prototype.hasOwnProperty.call(body, key)

  let username = user.username
  if (hasField('username')) {
    username = String(body.username || '').trim()
    if (username.length < 2 || username.length > 40) return jsonError(ctx, '用户名长度需为 2-40 个字符')
    if (/[\s<>]/.test(username)) return jsonError(ctx, '用户名不能包含空格或 < > 字符')
  }

  let gender = user.gender || ''
  if (hasField('gender')) {
    const nextGender = String(body.gender || '').trim()
    if (nextGender && !PROFILE_GENDERS.has(nextGender)) return jsonError(ctx, '性别字段不合法')
    gender = nextGender
  }

  let description = user.description || ''
  if (hasField('description')) {
    description = String(body.description || '').trim()
    if (description.length > MAX_PROFILE_DESCRIPTION_LENGTH) {
      return jsonError(ctx, `个人简介不能超过 ${MAX_PROFILE_DESCRIPTION_LENGTH} 个字符`)
    }
  }

  const update = {}
  if (username !== user.username) update.username = username
  if (gender !== (user.gender || '')) update.gender = gender
  if (description !== (user.description || '')) update.description = description

  try {
    if (update.username) {
      const matches = await DB.find(USER_COLLECTION, { username })
      const occupied = (matches || []).some((item) => item._id.toString() !== user._id.toString())
      if (occupied) return jsonError(ctx, '该用户名已被使用', 409)
    }

    if (Object.keys(update).length > 0) {
      await DB.update(USER_COLLECTION, { _id: user._id }, update)
    }

    ctx.body = {
      cc: 0,
      message: Object.keys(update).length > 0 ? '资料已更新' : '资料未变化',
      userId: user.userId || user._id.toString(),
      username,
      email: user.email || '',
      gender,
      description
    }
  } catch (error) {
    console.error('[CatKeeper] profile update failed:', error.message)
    jsonError(ctx, '资料保存失败，请稍后再试', 500)
  }
})

router.post('/delete-account', async (ctx) => {
  if (!enforceOrigin(ctx)) return jsonError(ctx, '来源未授权', 403)
  const user = await authenticateRequest(ctx)
  if (!user) return

  try {
    const userId = user.userId || user._id.toString()
    const items = (await DB.find(ITEM_COLLECTION, { userId })) || []
    const feedback = (await DB.find(FEEDBACK_COLLECTION, { userId })) || []
    await DB.remove(ITEM_COLLECTION, { userId })
    await DB.remove(FEEDBACK_COLLECTION, { userId })
    await DB.remove(CODE_COLLECTION, { email: normalizeEmail(user.email) })
    await DB.remove(USER_COLLECTION, { _id: DB.getObjectId(user._id) })

    items.forEach((item) => removeImageByUrl(item.imageUrl))
    feedback.forEach((entry) => {
      (entry.images || []).forEach((url) => removeImageByUrl(url))
    })

    console.log('[CatKeeper] account deleted:', userId)
    ctx.body = { cc: 0, message: '账户已注销' }
  } catch (error) {
    console.error('[CatKeeper] delete account failed:', error.message)
    jsonError(ctx, '注销失败，请稍后再试', 500)
  }
})

/* ============================== Images ============================== */

function detectImageMime(file) {
  const declared = String(file.type || file.mimetype || '').toLowerCase()
  if (IMAGE_EXT_BY_MIME[declared]) return declared
  const extension = path.extname(String(file.name || file.originalFilename || file.path || '')).toLowerCase()
  return IMAGE_MIME_BY_EXT[extension] || ''
}

function resolveImageExtension(file, mime) {
  const extension = path.extname(String(file.name || file.originalFilename || file.path || '')).toLowerCase()
  if (IMAGE_MIME_BY_EXT[extension]) return extension
  return IMAGE_EXT_BY_MIME[mime] || '.jpg'
}

function removeFile(filePath) {
  if (!filePath) return
  try {
    fs.unlinkSync(filePath)
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn('[CatKeeper] failed to remove file:', error.message)
    }
  }
}

function removeImageByUrl(url) {
  if (!url || !String(url).startsWith(IMAGE_URL_PREFIX)) return
  const fileName = path.basename(String(url))
  removeFile(path.join(IMAGE_DIR, fileName))
}

function persistImage(file, maxBytes) {
  if (!file || !file.path) return null

  const mime = detectImageMime(file)
  if (!mime) throw new Error('图片仅支持 JPG、PNG、WebP、GIF 格式')

  const sourcePath = path.resolve(file.path)
  let size = Number(file.size) || 0
  if (!size) {
    try {
      size = fs.statSync(sourcePath).size
    } catch (error) {
      size = 0
    }
  }
  if (!size) throw new Error('图片读取失败，请重新选择')
  if (size > maxBytes) throw new Error(`单张图片不能超过 ${Math.round(maxBytes / 1024 / 1024)}MB`)

  const fileName = `item-${Date.now()}-${crypto.randomBytes(6).toString('hex')}${resolveImageExtension(file, mime)}`
  const targetPath = path.join(IMAGE_DIR, fileName)

  try {
    fs.renameSync(sourcePath, targetPath)
  } catch (error) {
    if (error.code !== 'EXDEV') throw error
    fs.copyFileSync(sourcePath, targetPath)
    removeFile(sourcePath)
  }

  return { url: `${IMAGE_URL_PREFIX}/${fileName}`, path: targetPath, size, mime }
}

function getSingleImage(ctx, field = 'image') {
  const raw = ctx.request.files && ctx.request.files[field]
  if (!raw) return null
  return (Array.isArray(raw) ? raw[0] : raw) || null
}

function getImageList(ctx, field = 'images') {
  const raw = ctx.request.files && ctx.request.files[field]
  if (!raw) return []
  return (Array.isArray(raw) ? raw : [raw]).filter((file) => file && file.path)
}

/* ============================== Items ============================== */

function normalizeItem(item) {
  const category = item.category || {}
  return {
    id: item.id,
    name: item.name || '',
    imageUrl: item.imageUrl || '',
    category: {
      key: category.key || 'other',
      label: category.label || '其他',
      icon: category.icon || '📦',
      place: category.place || '柜子'
    },
    productionOn: item.productionOn || '',
    expiresOn: item.expiresOn || '',
    createdAt: Number(item.createdAt) || 0,
    discardedAt: Number(item.discardedAt) || 0,
    rescheduledAt: Number(item.rescheduledAt) || 0
  }
}

async function findUserItem(userId, id) {
  const list = await DB.find(ITEM_COLLECTION, { userId, id })
  return (list && list[0]) || null
}

router.get('/items', async (ctx) => {
  if (!enforceOrigin(ctx)) return jsonError(ctx, '来源未授权', 403)
  const user = await authenticateRequest(ctx)
  if (!user) return

  try {
    const userId = user.userId || user._id.toString()
    const items = (await DB.find(ITEM_COLLECTION, { userId })) || []
    const sorted = items
      .map(normalizeItem)
      .sort((a, b) => b.createdAt - a.createdAt)
    ctx.body = { cc: 0, items: sorted, updatedAt: Date.now() }
  } catch (error) {
    console.error('[CatKeeper] list items failed:', error.message)
    jsonError(ctx, '物品加载失败，请稍后再试', 500)
  }
})

router.post('/items', async (ctx) => {
  if (!enforceOrigin(ctx)) return jsonError(ctx, '来源未授权', 403)
  const rawImage = getSingleImage(ctx)
  let persisted = null

  try {
    const user = await authenticateRequest(ctx)
    if (!user) {
      if (rawImage?.path) removeFile(path.resolve(rawImage.path))
      return
    }

    const name = bodyString(ctx, 'name').trim()
    const categoryKey = bodyString(ctx, 'categoryKey').trim() || 'other'
    const categoryLabel = bodyString(ctx, 'categoryLabel').trim() || '其他'
    const categoryIcon = bodyString(ctx, 'categoryIcon').trim() || '📦'
    const categoryPlace = bodyString(ctx, 'categoryPlace').trim() || '柜子'
    const productionOn = bodyString(ctx, 'productionOn').trim()
    const expiresOn = bodyString(ctx, 'expiresOn').trim()

    if (!name || name.length > 40) throw new Error('物品名称需为 1-40 个字符')
    if (categoryLabel.length > 20) throw new Error('类别名称不能超过 20 个字符')
    if (!isValidDateString(productionOn)) throw new Error('生产日期格式不正确')
    if (!isValidDateString(expiresOn)) throw new Error('过期日期格式不正确')
    if (productionOn && expiresOn && expiresOn < productionOn) {
      throw new Error('过期日期不能早于生产日期')
    }

    persisted = rawImage ? persistImage(rawImage, MAX_ITEM_IMAGE_BYTES) : null
    const userId = user.userId || user._id.toString()
    const now = Date.now()
    const item = {
      id: `i-${now}-${crypto.randomBytes(5).toString('hex')}`,
      userId,
      name,
      imageUrl: persisted ? persisted.url : '',
      category: {
        key: categoryKey,
        label: categoryLabel,
        icon: categoryIcon,
        place: categoryPlace
      },
      productionOn,
      expiresOn,
      createdAt: now,
      discardedAt: 0,
      rescheduledAt: 0
    }

    await DB.insert(ITEM_COLLECTION, item)
    ctx.body = { cc: 0, item: normalizeItem(item) }
  } catch (error) {
    if (persisted?.path) removeFile(persisted.path)
    else if (rawImage?.path) removeFile(path.resolve(rawImage.path))
    console.error('[CatKeeper] create item failed:', error.message)
    jsonError(ctx, error.message || '收纳失败，请稍后再试', 400)
  }
})

router.post('/items/:id/discard', async (ctx) => {
  if (!enforceOrigin(ctx)) return jsonError(ctx, '来源未授权', 403)
  const user = await authenticateRequest(ctx)
  if (!user) return

  try {
    const userId = user.userId || user._id.toString()
    const item = await findUserItem(userId, ctx.params.id)
    if (!item) return jsonError(ctx, '找不到这件物品', 404)
    if (item.discardedAt) {
      ctx.body = { cc: 0, item: normalizeItem(item) }
      return
    }
    const discardedAt = Date.now()
    await DB.update(ITEM_COLLECTION, { _id: DB.getObjectId(item._id.toString()) }, { discardedAt })
    ctx.body = { cc: 0, item: normalizeItem({ ...item, discardedAt }) }
  } catch (error) {
    console.error('[CatKeeper] discard item failed:', error.message)
    jsonError(ctx, '操作失败，请稍后再试', 500)
  }
})

router.post('/items/:id/reschedule', async (ctx) => {
  if (!enforceOrigin(ctx)) return jsonError(ctx, '来源未授权', 403)
  const user = await authenticateRequest(ctx)
  if (!user) return

  const expiresOn = String(ctx.request.body?.expiresOn || '').trim()
  if (!expiresOn || !isValidDateString(expiresOn)) return jsonError(ctx, '请选择有效的过期日期')

  try {
    const userId = user.userId || user._id.toString()
    const item = await findUserItem(userId, ctx.params.id)
    if (!item) return jsonError(ctx, '找不到这件物品', 404)

    const rescheduledAt = Date.now()
    await DB.update(ITEM_COLLECTION, { _id: DB.getObjectId(item._id.toString()) }, {
      expiresOn,
      rescheduledAt
    })
    ctx.body = { cc: 0, item: normalizeItem({ ...item, expiresOn, rescheduledAt }) }
  } catch (error) {
    console.error('[CatKeeper] reschedule item failed:', error.message)
    jsonError(ctx, '设置失败，请稍后再试', 500)
  }
})

/* ============================== Feedback ============================== */

router.post('/feedback', async (ctx) => {
  if (!enforceOrigin(ctx)) return jsonError(ctx, '来源未授权', 403)
  const rawImages = getImageList(ctx)
  const persisted = []

  try {
    const user = await authenticateRequest(ctx)
    if (!user) {
      rawImages.forEach((file) => removeFile(path.resolve(file.path)))
      return
    }

    const text = bodyString(ctx, 'text').trim()
    if (text.length < 5) throw new Error('反馈内容至少需要 5 个字符')
    if (text.length > 1000) throw new Error('反馈内容不能超过 1000 个字符')
    if (rawImages.length > MAX_FEEDBACK_IMAGES) throw new Error(`最多只能上传 ${MAX_FEEDBACK_IMAGES} 张图片`)

    for (const file of rawImages) {
      const image = persistImage(file, MAX_FEEDBACK_IMAGE_BYTES)
      if (image) persisted.push(image)
    }

    const userId = user.userId || user._id.toString()
    await DB.insert(FEEDBACK_COLLECTION, {
      id: `f-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
      userId,
      text,
      images: persisted.map((image) => image.url),
      createdAt: Date.now()
    })

    ctx.body = { cc: 0, message: '反馈已提交' }
  } catch (error) {
    persisted.forEach((image) => removeFile(image.path))
    rawImages.forEach((file) => removeFile(path.resolve(file.path)))
    console.error('[CatKeeper] feedback failed:', error.message)
    jsonError(ctx, error.message || '反馈提交失败，请稍后再试', 400)
  }
})

module.exports = router
