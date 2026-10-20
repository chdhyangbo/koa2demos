const Router = require('koa-router');
let router = new Router({ prefix: '/api' });
const DB = require('../db/index.js');
const { ObjectID } = require('mongodb');
const jwt = require('jsonwebtoken')
const crypto = require('crypto');

// ====== Username/Password Login ======

router.post('/login', async (ctx, next) => {
    let { username } = ctx.request.body;
    let data = await DB.find('user', { username });
    if (!data || data.length === 0) {
        data = await DB.find('user', { phone: username });
    }
    try {
        if (data && data.length > 0) {
            let user = data[0];
            let received = ctx.request.body.password;
            let matched = received == user.password;
            if (!matched) {
                let hashedStored = crypto.createHash('sha256').update(user.password).digest('hex');
                if (received == hashedStored) {
                    matched = true;
                    await DB.update('user', { _id: new ObjectID(user._id.toString()) }, { password: received, passwordUpdatedAt: new Date() });
                }
            }
            if (!matched) {
                ctx.body = { message: '用户名或密码错误', cc: 1 }
                } else {
                    if (!user.userId) {
                        let uid = user._id.toString();
                        await DB.update('user', { _id: new ObjectID(uid) }, { userId: uid });
                        user.userId = uid;
                    }
                    let pwdTime = user.passwordUpdatedAt ? new Date(user.passwordUpdatedAt).getTime() : new Date().getTime();
                    let payload = {
                        username: user.username,
                        phone: user.phone,
                        email: user.email,
                        time: new Date().getTime(),
                        timeout: 1000 * 24 * 60 * 60,
                        pwdTime
                    }
                    let token = jwt.sign(payload, 'ybadmin')
                    ctx.body = { message: '登录成功', cc: 0, isFirst: user.isFirst, token, pwdTime, userId: user.userId, username: user.username }
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
