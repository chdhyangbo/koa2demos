module.exports = {
    appid: process.env.ALIPAY_APPID || 'YOUR_ALIPAY_APPID',
    appsecret: process.env.ALIPAY_APPSECRET || 'YOUR_ALIPAY_APPSECRET',
    redirect_uri: process.env.ALIPAY_REDIRECT_URI || 'http://localhost:8090/api/oauth/alipay/callback',
};
