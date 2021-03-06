const Koa  = require('koa');
const app = new Koa();
const KoaStatic = require('koa-static');
app.use(KoaStatic('./static'));
const koaBody = require('koa-body'); //解析上传文件的插件
const xmlParser = require('koa-xml-body');//解析xml文件的插件
const router = require('koa-router')();
const jwt = require('jsonwebtoken')
const registeRouter = require('./routers/registe')
const loginRouter = require('./routers/login')
const userRouter = require('./routers/user');
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
        || url.includes('/WX')) {
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
app.use(loginRouter.routes());//登录页面
app.use(registeRouter.routes());// 注册页面逻辑
app.use(userRouter.routes());// 用户增删改查路由
app.use(router.routes()).use(router.allowedMethods());

app.listen(80,()=>{
    console.log('[demo] server is starting at port 80');
});