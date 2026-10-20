module.exports = {
    appid: process.env.WX_APPID || 'YOUR_WECHAT_APPID',
    appsecret: process.env.WX_APPSECRET || 'YOUR_WECHAT_APPSECRET',
    mch_id: process.env.WX_MCH_ID || 'YOUR_MCH_ID',
    mch_key: process.env.WX_MCH_KEY || 'YOUR_MCH_KEY',
    notify_url: process.env.WX_NOTIFY_URL || 'https://yourdomain.com/api/wechat/notify',
    // OAuth2 login (微信开放平台 PC扫码登录)
    oauth_redirect_uri: process.env.WX_OAUTH_REDIRECT_URI || 'http://localhost:8090/api/oauth/wechat/callback',
};
