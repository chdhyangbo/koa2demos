const Koa = require("koa");
const https = require("https");
const fs = require("fs");
const app = new Koa();

// HTTP -> HTTPS 重定向中间件
app.use((ctx, next) => {
  // 只对下面的域名进行重定向
  if (ctx.request.protocol === "http" && ["frxavapes.com", "allbarbar.com"].includes(ctx.request.host)) {
    const httpsPort = 443; // HTTPS 端口
    const redirectUrl = `https://${ctx.request.host}:${httpsPort}${ctx.request.url}`;
    ctx.redirect(redirectUrl);
  } else {
    return next();
  }
});

// 生成静态目录
const KoaStatic = require("koa-static");

var tls = require('tls');
const path = require("path");
app.use(KoaStatic(path.join(__dirname, "./static")));
const koaBody = require("koa-body"); //解析上传文件的插件
const xmlParser = require("koa-xml-body"); //解析xml文件的插件
const router = require("koa-router")();
const jwt = require("jsonwebtoken");
// const registeRouter = require('./routers/registe')
// const loginRouter = require('./routers/login')
// const userRouter = require('./routers/user');
const searchSmokeRouter = require("./routers/searchSmoke");
const eluxSearchRouter = require("./routers/eluxSearch");
const antiSearchRouter = require("./routers/antiSearch");
const aromaKingSearchRouter = require("./routers/aromaKingSearch");
const smsCodeRouter = require("./routers/smsCode");
const scanCodeRouter = require("./routers/scan");
const uploadRouter = require("./routers/upload");

app.use(
  koaBody({
    multipart: true,
    formidable: {
      maxFileSize: 2000 * 1024 * 1024, // 设置上传文件大小最大限制，默认2M
      // 上传目录
      uploadDir: path.join(__dirname, "/public/upload"),
      // 是否保留拓展名
      keepExtensions: true,
    },
  })
);
app.use(xmlParser());
// 验证token
app.use(async (ctx, next) => {
  let url = ctx.request.url;
  console.log(url);
  // 设置接口白名单
  if (
    url == "/api/login" ||
    url == "/api/regist" ||
    url == "/api/uploadFile" ||
    url.includes("api/download/") ||
    url.includes("/search") ||
    url.includes("/api/eluxSearch") ||
    url.includes("/api/aromaKingSearch") ||
    url.includes("/api/antiSearch") ||
    url.includes("/api/smsCode") ||
    url.includes("/api/scan") ||
    url.includes("/api/searchSmoke")
  ) {
    await next();
  } else {
    let token = ctx.request.headers["token"];
    console.log(token);
    // 解码
    let payload = jwt.verify(token, "ybadmin");
    let { time, timeout, phone, username } = payload;
    let date = new Date().getTime();
    if (date - time <= timeout) {
      // 记录到ctx全局中
      ctx.token = {
        username,
        phone, // 登录记录手机号
      };
      await next();
    } else {
      ctx.body = {
        message: "token已过期，请重新登录",
        cc: 9999,
      };
    }
  }
});

//启动路由
// app.use(loginRouter.routes());//登录页面
// app.use(registeRouter.routes());// 注册页面逻辑
// app.use(userRouter.routes());// 用户增删改查路由
app.use(searchSmokeRouter.routes()); // 电子烟增删改查路由
app.use(eluxSearchRouter.routes()); // 电子烟增删改查路由
app.use(aromaKingSearchRouter.routes()); // 电子烟增删改查路由
app.use(antiSearchRouter.routes()); // 电子烟增删改查路由
app.use(smsCodeRouter.routes()); // 验证码增删改查路由
app.use(scanCodeRouter.routes()); // 扫一扫增删改查路由
app.use(uploadRouter.routes());

app.use(router.routes()).use(router.allowedMethods());

app.listen(80, "0.0.0.0", () => {
  console.log("[demo] server is starting at port 80");
});

// Load SSL certificate and private key 多域名配置
const secureContext = {
  'allbarbar.com': tls.createSecureContext({
    key: fs.readFileSync("allbarbar_com.key"),
    cert: fs.readFileSync("allbarbar_com.pem"),
  }),
  'frxavapes.com': tls.createSecureContext({
    key: fs.readFileSync("frxavapes_com.key"),
    cert: fs.readFileSync("frxavapes_com.pem"),
  }),
}
const options = {
  SNICallback: function (domain, cb) {
    if (secureContext[domain]) {
      if (cb) {
        cb(null, secureContext[domain]);
      } else {
        // compatibility for older versions of node
        return secureContext[domain];
      }
    } else {
      // return secureContext[domain];
      throw new Error('No keys/certificates for domain requested');
    }
  },
  key: fs.readFileSync("frxavapes_com.key"),
  cert: fs.readFileSync("frxavapes_com.pem"),
};

// const options = {
//   key: fs.readFileSync("frxavapes_com.key"),
//   cert: fs.readFileSync("frxavapes_com.pem"),
// };

// Create HTTPS server
https.createServer(options, app.callback()).listen(443, () => {
  console.log("Koa.js server running on https://localhost:443");
});
