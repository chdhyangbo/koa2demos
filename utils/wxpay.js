const crypto = require('crypto');
const axios = require('axios');
const { parseStringPromise } = require('xml2js');
const qs = require('querystring');
const config = require('../config/wechat');

function genNonceStr(len = 32) {
    return crypto.randomBytes(len / 2).toString('hex');
}

function signParams(params, key) {
    // sort keys
    const sorted = Object.keys(params).filter(k => params[k] !== undefined && params[k] !== '' ).sort();
    const str = sorted.map(k => `${k}=${params[k]}`).join('&') + `&key=${key}`;
    return crypto.createHash('md5').update(str, 'utf8').digest('hex').toUpperCase();
}

function buildXml(obj) {
    let xml = '<xml>';
    for (const k in obj) {
        xml += `<${k}><![CDATA[${obj[k]}]]></${k}>`;
    }
    xml += '</xml>';
    return xml;
}

async function unifiedOrder({ body, out_trade_no, total_fee, spbill_create_ip, openid }) {
    const url = 'https://api.mch.weixin.qq.com/pay/unifiedorder';
    const params = {
        appid: config.appid,
        mch_id: config.mch_id,
        nonce_str: genNonceStr(32),
        body: body || 'Order',
        out_trade_no: out_trade_no,
        total_fee: total_fee + '', // in fen
        spbill_create_ip: spbill_create_ip || '127.0.0.1',
        notify_url: config.notify_url,
        trade_type: 'JSAPI',
        openid: openid
    };
    params.sign = signParams(params, config.mch_key);
    const xml = buildXml(params);
    const resp = await axios.post(url, xml, { headers: { 'Content-Type': 'text/xml' }, timeout: 10000 });
    const parsed = await parseStringPromise(resp.data, { explicitArray: false, trim: true });
    return parsed.xml || parsed;
}

function genPayRequestParams(prepay_id) {
    const timeStamp = Math.floor(Date.now() / 1000).toString();
    const nonceStr = genNonceStr(32);
    const pkg = `prepay_id=${prepay_id}`;
    const ret = {
        appId: config.appid,
        timeStamp,
        nonceStr,
        package: pkg,
        signType: 'MD5'
    };
    ret.paySign = signParams({
        appId: ret.appId,
        timeStamp: ret.timeStamp,
        nonceStr: ret.nonceStr,
        package: ret.package,
        signType: ret.signType
    }, config.mch_key);
    return ret;
}

module.exports = {
    unifiedOrder,
    genPayRequestParams,
    signParams
};
