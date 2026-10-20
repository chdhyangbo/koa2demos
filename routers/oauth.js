const Router = require('koa-router');
let router = new Router({ prefix: '/api/oauth' });
const DB = require('../db/index.js');
const { ObjectID } = require('mongodb');
const jwt = require('jsonwebtoken')
const axios = require('axios');
const wechatConfig = require('../config/wechat.js');
const alipayConfig = require('../config/alipay.js');

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

// ─── 微信扫码登录 ───

router.get('/wechat', async (ctx) => {
    const redirectUri = encodeURIComponent(wechatConfig.oauth_redirect_uri);
    const state = Math.random().toString(36).slice(2);
    const url = `https://open.weixin.qq.com/connect/qrconnect?appid=${wechatConfig.appid}&redirect_uri=${redirectUri}&response_type=code&scope=snsapi_login&state=${state}#wechat_redirect`;
    ctx.redirect(url);
});

router.get('/wechat/callback', async (ctx) => {
    const { code } = ctx.query;
    if (!code) {
        ctx.body = '<script>alert("微信登录失败：缺少code");window.close();</script>';
        return;
    }
    try {
        // 用 code 换 access_token
        const tokenRes = await axios.get('https://api.weixin.qq.com/sns/oauth2/access_token', {
            params: { appid: wechatConfig.appid, secret: wechatConfig.appsecret, code, grant_type: 'authorization_code' }
        });
        const { access_token, openid } = tokenRes.data;
        if (!access_token) {
            ctx.body = `<script>alert("微信登录失败：${tokenRes.data.errmsg || '未知错误'}");window.close();</script>`;
            return;
        }
        // 获取用户信息
        const userRes = await axios.get('https://api.weixin.qq.com/sns/userinfo', {
            params: { access_token, openid }
        });
        const { nickname, headimgurl } = userRes.data;
        // 查找或创建 userManager 用户
        let users = await DB.find('userManager', { wechatOpenid: openid });
        let user;
        if (users && users.length > 0) {
            user = users[0];
        } else {
            // 用 openid 后几位做默认用户名
            const defaultName = 'wx_' + openid.slice(-8);
            const insertRes = await DB.insert('userManager', {
                username: defaultName,
                password: '',
                phone: '',
                email: '',
                wechatOpenid: openid,
                wechatNickname: nickname,
                wechatAvatar: headimgurl,
                time: new Date().toISOString().split('T')[0],
                passwordUpdatedAt: new Date()
            });
            if (insertRes.acknowledged) {
                const uid = insertRes.insertedId.toString();
                await DB.update('userManager', { _id: new ObjectID(uid) }, { userId: uid });
                user = { _id: uid, userId: uid, username: defaultName };
            }
        }
        if (user) {
            const token = jwt.sign({ username: user.username, phone: '', email: '', time: Date.now(), timeout: 86400000, pwdTime: Date.now() }, 'ybadmin');
            ctx.redirect(`${FRONTEND_URL}/oauth/callback?token=${token}&userId=${user.userId || user._id}&username=${encodeURIComponent(user.username)}`);
        }
    } catch (err) {
        console.error('[wechat oauth error]', err.message);
        ctx.body = '<script>alert("微信登录失败");window.close();</script>';
    }
});

// ─── 支付宝登录 ───

router.get('/alipay', async (ctx) => {
    const redirectUri = encodeURIComponent(alipayConfig.redirect_uri);
    const url = `https://openauth.alipay.com/oauth2/publicAppAuthorize.htm?app_id=${alipayConfig.appid}&scope=auth_user&redirect_uri=${redirectUri}`;
    ctx.redirect(url);
});

router.get('/alipay/callback', async (ctx) => {
    const { auth_code } = ctx.query;
    if (!auth_code) {
        ctx.body = '<script>alert("支付宝登录失败：缺少auth_code");window.close();</script>';
        return;
    }
    try {
        // 用 auth_code 换 access_token
        const tokenRes = await axios.post('https://openapi.alipay.com/gateway.do', null, {
            params: {
                method: 'alipay.system.oauth.token',
                grant_type: 'authorization_code',
                code: auth_code,
                app_id: alipayConfig.appid,
                secret: alipayConfig.appsecret,
                charset: 'utf-8',
                format: 'JSON',
                version: '1.0',
            }
        });
        const { alipay_system_oauth_token_response } = tokenRes.data;
        if (!alipay_system_oauth_token_response || alipay_system_oauth_token_response.code !== '10000') {
            ctx.body = '<script>alert("支付宝登录失败：获取token失败");window.close();</script>';
            return;
        }
        const { user_id, access_token } = alipay_system_oauth_token_response;
        // 获取用户信息
        const userRes = await axios.post('https://openapi.alipay.com/gateway.do', null, {
            params: {
                method: 'alipay.user.info.share',
                auth_token: access_token,
                app_id: alipayConfig.appid,
                charset: 'utf-8',
                format: 'JSON',
                version: '1.0',
            }
        });
        const { alipay_user_info_share_response } = userRes.data;
        const nickName = alipay_user_info_share_response?.nick_name || ('ali_' + user_id.slice(-8));
        // 查找或创建 userManager 用户
        let users = await DB.find('userManager', { alipayUserId: user_id });
        let user;
        if (users && users.length > 0) {
            user = users[0];
        } else {
            const insertRes = await DB.insert('userManager', {
                username: nickName,
                password: '',
                phone: '',
                email: '',
                alipayUserId: user_id,
                alipayNickname: nickName,
                alipayAvatar: alipay_user_info_share_response?.avatar || '',
                time: new Date().toISOString().split('T')[0],
                passwordUpdatedAt: new Date()
            });
            if (insertRes.acknowledged) {
                const uid = insertRes.insertedId.toString();
                await DB.update('userManager', { _id: new ObjectID(uid) }, { userId: uid });
                user = { _id: uid, userId: uid, username: nickName };
            }
        }
        if (user) {
            const token = jwt.sign({ username: user.username, phone: '', email: '', time: Date.now(), timeout: 86400000, pwdTime: Date.now() }, 'ybadmin');
            ctx.redirect(`${FRONTEND_URL}/oauth/callback?token=${token}&userId=${user.userId || user._id}&username=${encodeURIComponent(user.username)}`);
        }
    } catch (err) {
        console.error('[alipay oauth error]', err.message);
        ctx.body = '<script>alert("支付宝登录失败");window.close();</script>';
    }
});

module.exports = router;
