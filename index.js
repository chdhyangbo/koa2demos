const Koa  = require('koa');
const app = new Koa();

// 生成静态目录
const KoaStatic = require('koa-static');

const path = require('path')
app.use(KoaStatic(path.join( __dirname, './static')));
const koaBody = require('koa-body'); //解析上传文件的插件
const xmlParser = require('koa-xml-body');//解析xml文件的插件
const router = require('koa-router')();
const jwt = require('jsonwebtoken')
// const registeRouter = require('./routers/registe')
// const loginRouter = require('./routers/login')
// const userRouter = require('./routers/user');
const searchSmokeRouter = require('./routers/searchSmoke');
const eluxSearchRouter = require('./routers/eluxSearch');
const antiSearchRouter = require('./routers/antiSearch');
const aromaKingSearchRouter = require('./routers/aromaKingSearch');
const smsCodeRouter = require('./routers/smsCode');
const scanCodeRouter = require('./routers/scan');

const Application = require('koa');
app.use(koaBody({
    multipart: true,
    formidable: {
        maxFileSize: 2000 * 1024 * 1024    // 设置上传文件大小最大限制，默认2M
    }
}))
app.use(xmlParser())
// 验证token
app.use(async (ctx, next) => {
    let url = ctx.request.url;
    console.log(url);
    // 设置接口白名单
    if (url == '/api/login' || 
        url == '/api/regist' || 
        url == "/api/uploadFile" || 
        url.includes('api/download/') 
        || url.includes('/search')
        || url.includes('/api/eluxSearch')
        || url.includes('/api/aromaKingSearch')
        || url.includes('/api/antiSearch')
        || url.includes('/api/smsCode')
        || url.includes('/api/scan')
        || url.includes('/api/searchSmoke')) {
        await next()
    } else {
        let token = ctx.request.headers['token'];
        console.log(token);
        // 解码
        let payload = jwt.verify(token, 'ybadmin');
        let { time, timeout, phone, username} = payload;
        let date = new Date().getTime();
        if ( date - time <= timeout) {
            // 记录到ctx全局中
            ctx.token = {
                username,
                phone,// 登录记录手机号
            }
            await next();
        } else {
            ctx.body = {
                message: 'token已过期，请重新登录',
                cc: 9999
            }
        }
    }
})


//启动路由
// app.use(loginRouter.routes());//登录页面
// app.use(registeRouter.routes());// 注册页面逻辑
// app.use(userRouter.routes());// 用户增删改查路由
app.use(searchSmokeRouter.routes());// 电子烟增删改查路由
app.use(eluxSearchRouter.routes());// 电子烟增删改查路由
app.use(aromaKingSearchRouter.routes());// 电子烟增删改查路由
app.use(antiSearchRouter.routes());// 电子烟增删改查路由 
app.use(smsCodeRouter.routes());// 验证码增删改查路由 
app.use(scanCodeRouter.routes());// 扫一扫增删改查路由 




app.use(router.routes()).use(router.allowedMethods());

app.listen(80,'0.0.0.0',()=>{
    console.log('[demo] server is starting at port 80');
});