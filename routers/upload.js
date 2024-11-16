const Router = require("koa-router");
let router = new Router({
  prefix: "/api",
});

router.post("/uploadFile", (ctx) => {
  const path = ctx.request.files;
  ctx.body = { path: path };
});

module.exports = router;
