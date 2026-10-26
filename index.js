require("./config/env");

const Koa = require("koa");
const https = require("https");
const fs = require("fs");
const { isAllowedOrigin } = require("./utils/origin");
const app = new Koa();

// HTTP -> HTTPS 重定向中间件
app.use((ctx, next) => {
  // 只对下面的域名进行重定向
  if (ctx.request.protocol === "http" && ["frxavapes.com", "allbarbar.com", "geekbor.com"].includes(ctx.request.host)) {
    const httpsPort = 443; // HTTPS 端口
    const redirectUrl = `https://${ctx.request.host}:${httpsPort}${ctx.request.url}`;
    ctx.redirect(redirectUrl);
  } else {
    return next();
  }
});

// Allow the native app WebView and explicitly configured H5 origins to call the auth API.
app.use(async (ctx, next) => {
  const origin = ctx.get('origin');
  const allowed = isAllowedOrigin(ctx, origin);
  if (origin && allowed) {
    ctx.set('Access-Control-Allow-Origin', origin);
    ctx.set('Vary', 'Origin');
    ctx.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    ctx.set('Access-Control-Allow-Headers', 'Content-Type, token');
    ctx.set('Access-Control-Max-Age', '600');
  }
  if (ctx.method === 'OPTIONS') {
    ctx.status = origin && allowed ? 204 : 403;
    return;
  }
  await next();
});

// 生成静态目录
const KoaStatic = require("koa-static");
const send = require("koa-send");

var tls = require('tls');
const path = require("path");
app.use(KoaStatic(path.join(__dirname, "./static")));
// 为部署在子路径下的前端应用提供静态资源 404 和 SPA 页面回退。
app.use(async (ctx, next) => {
  if (ctx.method !== "GET" && ctx.method !== "HEAD") return next();

  const apps = [
    { prefix: "/admin-dashboard", directory: "admin-dashboard" },
    { prefix: "/operation", directory: "operation" },
  ];
  const frontend = apps.find(
    ({ prefix }) => ctx.path === prefix || ctx.path.startsWith(`${prefix}/`)
  );
  if (!frontend) return next();

  const relativePath = ctx.path.slice(frontend.prefix.length);
  // React Router 的无扩展名路径需要返回 index.html；缺失的资源应明确 404。
  if (relativePath === "" || relativePath === "/" || !path.extname(relativePath)) {
    await send(ctx, "index.html", {
      root: path.join(__dirname, "static", frontend.directory),
    });
    return;
  }

  ctx.status = 404;
  ctx.body = "Not Found";
});
const koaBody = require("koa-body"); //解析上传文件的插件
const xmlParser = require("koa-xml-body"); //解析xml文件的插件
const router = require("koa-router")();
const jwt = require("jsonwebtoken");
const registeRouter = require('./routers/registe')
const loginRouter = require('./routers/login')
const userRouter = require('./routers/user');
const searchSmokeRouter = require("./routers/searchSmoke");
const eluxSearchRouter = require("./routers/eluxSearch");
const antiSearchRouter = require("./routers/antiSearch");
const aromaKingSearchRouter = require("./routers/aromaKingSearch");
const smsCodeRouter = require("./routers/smsCode");
const scanCodeRouter = require("./routers/scan");
const uploadRouter = require("./routers/upload");
const usageRouter = require("./routers/usage");
const adminLoginRouter = require("./routers/adminLogin");
const oauthRouter = require("./routers/oauth");
const timewhisperAuthRouter = require("./routers/timewhisperAuth");
const timewhisperCapsulesRouter = require("./routers/timewhisperCapsules");
const timewhisperSplashRouter = require("./routers/timewhisperSplash");

const uploadDir = path.join(__dirname, "public/upload");
fs.mkdirSync(uploadDir, { recursive: true });

app.use(
  koaBody({
    multipart: true,
    formidable: {
      maxFileSize: 2000 * 1024 * 1024, // 设置上传文件大小最大限制，默认2M
      // 上传目录
      uploadDir,
      // 是否保留扩展名
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
    url == "/api/admin/login" ||
    url == "/api/admin/regist" ||
    url == "/api/regist" ||
    url.startsWith("/api/timewhisper/") ||
    url == "/api/uploadFile" ||
    url.includes("api/download/") ||
    url.includes("/search") ||
    url.includes("/api/eluxSearch") ||
    url.includes("/api/aromaKingSearch") ||
    url.includes("/api/antiSearch") ||
    url.includes("/api/smsCode") ||
    url.includes("/api/scan") ||
    url.includes("/api/searchSmoke") ||
    url.includes("/api/wechat") ||
    url.includes("/api/usage") ||
    url.includes("/api/oauth")
  ) {
    await next();
  } else {
    let token = ctx.request.headers["token"];
    console.log(token);
    if(!token) {
      await next();
    }
    // 解码
    let payload = jwt.verify(token, process.env.JWT_SECRET || "ybadmin");
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
app.use(loginRouter.routes());//登录页面
app.use(registeRouter.routes());// 注册页面逻辑
app.use(timewhisperAuthRouter.routes()).use(timewhisperAuthRouter.allowedMethods());
app.use(timewhisperCapsulesRouter.routes()).use(timewhisperCapsulesRouter.allowedMethods());
app.use(timewhisperSplashRouter.routes()).use(timewhisperSplashRouter.allowedMethods());
app.use(userRouter.routes());// 用户增删改查路由
app.use(searchSmokeRouter.routes()); // 电子烟增删改查路由
app.use(eluxSearchRouter.routes()); // 电子烟增删改查路由
app.use(aromaKingSearchRouter.routes()); // 电子烟增删改查路由
app.use(antiSearchRouter.routes()); // 电子烟增删改查路由
app.use(smsCodeRouter.routes()); // 验证码增删改查路由
app.use(scanCodeRouter.routes()); // 扫一扫增删改查路由
app.use(uploadRouter.routes());
app.use(usageRouter.routes());
app.use(adminLoginRouter.routes());
app.use(oauthRouter.routes());

app.use(router.routes()).use(router.allowedMethods());

app.on('error', (err, ctx) => {
  console.error('[ERROR]', err.message, err.stack);
});

const APP_PORT = process.env.NODE_ENV === 'production' ? 80 : 8090;
app.listen(APP_PORT, "0.0.0.0", () => {
  console.log("[demo] server is starting at port " + APP_PORT);
});


// Load SSL certificate and private key 多域名配置
const secureContext = {
  'cssshop.com.cn': tls.createSecureContext({
    key: fs.readFileSync("cssshop.com.cn.key"),
    cert: fs.readFileSync("cssshop.com.cn.crt"),
  }),
  'www.cssshop.com.cn': tls.createSecureContext({
    key: fs.readFileSync("cssshop.com.cn.key"),
    cert: fs.readFileSync("cssshop.com.cn.crt"),
  })
}
const options = {
  SNICallback: function (domain, cb) {
    console.log[domain];
    if (secureContext[domain]) {
      if (cb) {
        console.log(domain)
        cb(null, secureContext[domain]);
      } else {
        // compatibility for older versions of node
        return secureContext[domain];
      }
    } else {
      return secureContext['cssshop.com.cn'];
      throw new Error('No keys/certificates for domain requested');
    }
  },
  key: fs.readFileSync("cssshop.com.cn.key"),
  cert: fs.readFileSync("cssshop.com.cn.crt"),
};

// const options = {
//   key: fs.readFileSync("frxavapes_com.key"),
//   cert: fs.readFileSync("frxavapes_com.pem"),
// };

// Create HTTPS server
if (process.env.NODE_ENV === 'production') {
  https.createServer(options, app.callback()).listen(443, () => {
    console.log("Koa.js server running on https://localhost:443");
  });
}
