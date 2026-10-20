const Router = require('koa-router');
let router = new Router({ prefix: '/api/admin' });
const DB = require('../db/index.js');
const { ObjectID } = require('mongodb');
const jwt = require('jsonwebtoken')
const crypto = require('crypto');
const moment = require('moment');

router.post('/login', async (ctx) => {
    let { username } = ctx.request.body;
    let data = await DB.find('userManager', { username });
    if (!data || data.length === 0) {
        data = await DB.find('userManager', { phone: username });
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
                    await DB.update('userManager', { _id: new ObjectID(user._id.toString()) }, { password: received, passwordUpdatedAt: new Date() });
                }
            }
            if (!matched) {
                ctx.body = { message: '用户名或密码错误', cc: 1 }
            } else {
                if (!user.userId) {
                    let uid = user._id.toString();
                    await DB.update('userManager', { _id: new ObjectID(uid) }, { userId: uid });
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
});

router.post('/regist', async (ctx) => {
    try {
        let { password, username, phone = '', email = '' } = ctx.request.body;
        console.log('[regist] body:', ctx.request.body);
        if (!password) { ctx.body = { message: '密码还未填写！', cc: 1 }; return }
        if (!username) { ctx.body = { message: '用户名称还未填写！', cc: 1 }; return }
        let data = await DB.find('userManager', { username });
        if (data && data.length > 0) {
            ctx.body = { message: '该用户名已经存在，请重新输入', cc: 1 }
            return
        }
        if (phone) {
            let phoneData = await DB.find('userManager', { phone });
            if (phoneData && phoneData.length > 0) {
                ctx.body = { message: '该手机号已被注册', cc: 1 }
                return
            }
        }
        let insertData = await DB.insert('userManager', {
            username,
            password,
            phone,
            email,
            time: moment(new Date()).format('YYYY-MM-DD HH:mm:ss'),
            passwordUpdatedAt: new Date()
        });
        if (insertData.acknowledged) {
            let userId = insertData.insertedId.toString();
            await DB.update('userManager', { _id: new ObjectID(userId) }, { userId });
            ctx.body = { message: '注册管理员成功', cc: 0, userId }
        }
    } catch (err) {
        console.error('[regist error]', err.message, err.stack);
        ctx.body = { message: '注册失败：' + err.message, cc: 1 }
    }
});

module.exports = router;
