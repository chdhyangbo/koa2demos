const Router = require('koa-router');
let router = new Router({ prefix: '/api' });
const DB = require('../db/index.js');
const { ObjectID } = require('mongodb');
const jwt = require('jsonwebtoken')
const crypto = require('crypto');

function verifyScryptPassword(received, stored) {
    if (typeof stored !== 'string' || !stored.startsWith('scrypt$')) return false;
    const [, salt, expectedHex] = stored.split('$');
    if (!salt || !expectedHex) return false;
    const expected = Buffer.from(expectedHex, 'hex');
    const actual = crypto.scryptSync(String(received || ''), salt, expected.length);
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

// ====== Username/Password Login ======

router.post('/login', async (ctx, next) => {
    let { username, app } = ctx.request.body;
    let data = await DB.find('user', { username });
    if ((!data || data.length === 0) && app !== 'timewhisper') {
        data = await DB.find('user', { phone: username });
    }
    try {
        if (data && data.length > 0) {
            let user = data[0];
            let received = ctx.request.body.password;
            if (app === 'timewhisper' && !user.timewhisperAuth) {
                ctx.body = { message: '用户名或密码错误', cc: 1 }
                return
            }
            let matched = verifyScryptPassword(received, user.password) || received == user.password;
            if (!matched) {
                let hashedStored = crypto.createHash('sha256').update(String(user.password)).digest('hex');
                let receivedHash = crypto.createHash('sha256').update(String(received)).digest('hex');
                if (received == hashedStored || receivedHash == user.password) {
                    matched = true;
                    if (app !== 'timewhisper') {
                        await DB.update('user', { _id: new ObjectID(user._id.toString()) }, { password: received, passwordUpdatedAt: new Date() });
                    }
                }
            }
            if (!matched) {
                ctx.body = { message: '用户名或密码错误', cc: 1 }
            } else if (app === 'timewhisper' && !user.emailVerified) {
                const codeRecords = await DB.find('timewhisperEmailCodes', { email: user.email, purpose: 'register' });
                const sentAt = codeRecords?.[0]?.sentAt ? new Date(codeRecords[0].sentAt).getTime() : 0;
                ctx.status = 403;
                ctx.body = {
                    message: '邮箱尚未验证，请完成邮箱验证后登录',
                    cc: 1,
                    emailVerificationRequired: true,
                    email: user.email,
                    canResend: Date.now() - sentAt >= 60 * 1000,
                }
            } else {
                    if (!user.userId) {
                        let uid = user._id.toString();
                        await DB.update('user', { _id: new ObjectID(uid) }, { userId: uid });
                        user.userId = uid;
                    }
                    let pwdTime = user.passwordUpdatedAt ? new Date(user.passwordUpdatedAt).getTime() : new Date().getTime();
                    let payload = {
                        userId: user.userId,
                        username: user.username,
                        phone: user.phone,
                        email: user.email,
                        emailVerified: !!user.emailVerified,
                        time: new Date().getTime(),
                        timeout: 1000 * 24 * 60 * 60,
                        pwdTime
                    }
                    let token = jwt.sign(payload, process.env.JWT_SECRET || 'ybadmin')
                    ctx.body = { message: '登录成功', cc: 0, isFirst: user.isFirst, token, pwdTime, userId: user.userId, username: user.username, email: user.email || '' }
            }
        } else {
            ctx.body = { message: '用户名或密码错误', cc: 1 }
        }
    } catch (err) {
        ctx.body = { message: '登录失败', cc: 1 }
    }
    await next()
});

module.exports = router;
