/*
 * @Author: yb 
 * @Date: 2022-01-24 20:35:25 
 * @Last Modified by: mikey.zhaopeng
 * @Last Modified time: 2022-07-10 11:57:06
 * 对luex电子烟序列号进行查询
 */
const Router = require('koa-router');
let router = new Router({
    prefix: '/api'
});
const fs = require('fs');
const DB = require('../db/index.js');
const path = require('path');
const koaBody = require('koa-body'); //解析上传文件的插件
const moment = require('moment');
const geoip = require('geoip-lite');
const wxpay = require('../utils/wxpay');
const wechatConfig = require('../config/wechat');
const axios = require('axios');


    // WeChat OAuth redirect: redirect user to WeChat to obtain code -> openid
    router.get('/wechat/oauth', async (ctx) => {
        const { redirect } = ctx.query;
        const redirectUri = encodeURIComponent(redirect || `${ctx.origin}/`);
        const url = `https://open.weixin.qq.com/connect/oauth2/authorize?appid=${wechatConfig.appid}&redirect_uri=${redirectUri}&response_type=code&scope=snsapi_base&state=STATE#wechat_redirect`;
        ctx.redirect(url);
    });

    // OAuth callback: exchange code for openid and redirect back with openid appended
    router.get('/wechat/callback', async (ctx) => {
        const { code, state, redirect } = ctx.query;
        if (!code) {
            ctx.body = 'no code';
            return;
        }
        try {
            const tokenUrl = `https://api.weixin.qq.com/sns/oauth2/access_token?appid=${wechatConfig.appid}&secret=${wechatConfig.appsecret}&code=${code}&grant_type=authorization_code`;
            const resp = await axios.get(tokenUrl, { timeout: 8000 });
            const data = resp.data;
            const openid = data.openid;
            let dest = redirect || '/';
            // add openid as query param
            const sep = dest.includes('?') ? '&' : '?';
            ctx.redirect(`${dest}${sep}openid=${openid}`);
        } catch (e) {
            ctx.body = 'oauth error';
        }
    });

    // Create a JSAPI order and return the parameters required by WeixinJSBridge
    router.post('/wechat/pay', async (ctx) => {
        const { body: bodyText, out_trade_no, total_fee, openid } = ctx.request.body;
        if (!openid) {
            ctx.status = 400;
            ctx.body = { error: 'openid required' };
            return;
        }
        // total_fee should be in fen (integer). If user sends in yuan, convert outside or here.
        try {
            const ip = ctx.request.ip || ctx.ip || ctx.request.header['x-forwarded-for'] || '127.0.0.1';
            const uni = await wxpay.unifiedOrder({
                body: bodyText || 'Payment',
                out_trade_no: out_trade_no || `order_${Date.now()}`,
                total_fee: total_fee || '1',
                spbill_create_ip: ip.replace('::ffff:', ''),
                openid
            });
            if (uni.return_code === 'SUCCESS' && uni.result_code === 'SUCCESS') {
                const prepay_id = uni.prepay_id;
                const payParams = wxpay.genPayRequestParams(prepay_id);
                ctx.body = { success: true, payParams };
            } else {
                ctx.body = { success: false, uni };
            }
        } catch (err) {
            ctx.body = { success: false, error: (err && err.message) || err };
        }
    });

    // Optional notify URL endpoint (WeChat will POST XML here). Minimal stub.
    /**
     * @swagger
     * /api/wechat/notify:
     *   post:
     *     summary: Receive WeChat payment notification (XML payload)
     *     requestBody:
     *       content:
     *         application/xml:
     *           schema:
     *             type: string
     *     responses:
     *       200:
     *         description: XML acknowledgement for WeChat
     */
    router.post('/wechat/notify', koaBody({ multipart: false, json: false }), async (ctx) => {
        // Should parse xml and verify signature. Here we accept and reply success for now.
        ctx.type = 'xml';
        ctx.body = `<xml><return_code><![CDATA[SUCCESS]]></return_code><return_msg><![CDATA[OK]]></return_msg></xml>`;
    });



module.exports = router;