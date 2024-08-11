/*
 * @Author: yjb
 * @Date: 2023-12-13 20:35:25
 * @Last Modified by: yjb
 * @Last Modified time: 2023-12-13 20:35:25
 * 验证码
 */
const ipnet = require("xz-ipnet")();
const Router = require("koa-router");
let router = new Router({
  prefix: "/api",
});
const DB = require("../db/index.js");
const moment = require("moment");
const { async } = require("node-stream-zip");
const { log } = require("handlebars");

router.post("/smsCode/query", async (ctx, next) => {
  const { searchNumber, ip = "", city = "" } = ctx.request.body;
  let codeItem = [];
  try {
    codeItem = await DB.find("smsCode", {
      value: searchNumber,
    });
  } catch (error) {
    console.log(error);
    ctx.body = {
      message: "query fail",
      cc: 1,
    };
    next();
  }

  console.log(codeItem);
  codeItem = codeItem[0];
  let body = {};
  if (codeItem && codeItem._id && codeItem.canQuery != 1) {
    codeItem.queryTime ? void 0 : (codeItem.queryTime = []);

    await DB.update(
      "smsCode",
      { _id: DB.getObjectId(codeItem._id) },
      {
        ...codeItem,
        queryTime: [
          ...codeItem.queryTime,
          {
            time: moment(new Date()).format("YYYY-MM-DD HH:mm:ss"),
            ip,
            city,
          },
        ],
      }
    );
    body = {
      message: "verify success",
      ...codeItem,
      cc: 0,
    };
  } else {
    body = {
      message: "query fail",
      cc: 1,
    };
  }
  ctx.body = body;
});

router.post("/smsCode/voodooQuery", async (ctx, next) => {
  const { searchNumber, ip = "", city = "" } = ctx.request.body;

  let codeItem = await DB.find("voodooSmsCode", {
    value: searchNumber,
  });
  console.log(codeItem);
  codeItem = codeItem[0];
  let body = {};
  if (codeItem && codeItem._id) {
    codeItem.queryTime ? void 0 : (codeItem.queryTime = []);

    await DB.update(
      "voodooSmsCode",
      { _id: DB.getObjectId(codeItem._id) },
      {
        ...codeItem,
        queryTime: [
          ...codeItem.queryTime,
          {
            time: moment(new Date()).format("YYYY-MM-DD HH:mm:ss"),
            ip,
            city,
          },
        ],
      }
    );
    body = {
      message: "verify success",
      ...codeItem,
      cc: 0,
    };
  } else {
    body = {
      message: "query fail",
      cc: 1,
    };
  }
  ctx.body = body;
});

router.post("/smsCode/elfp", async (ctx, next) => {
  const { searchNumber, ip = "", city = "" } = ctx.request.body;

  let codeItem = await DB.find("elfpSmsCode", {
    value: searchNumber,
  });
  console.log(codeItem);
  codeItem = codeItem[0];

  let body = {};
  if (codeItem && codeItem._id && codeItem.canQuery != 1) {
    codeItem.queryTime ? void 0 : (codeItem.queryTime = []);

    // if (codeItem.queryTime.length >= 1) {
    //   body = {
    //     message: 'query too many times',
    //     cc: 1
    //   };
    // } else {
    await DB.update(
      "elfpSmsCode",
      { _id: DB.getObjectId(codeItem._id) },
      {
        ...codeItem,
        queryTime: [
          ...codeItem.queryTime,
          {
            time: moment(new Date()).format("YYYY-MM-DD HH:mm:ss"),
            ip,
            city,
          },
        ],
      }
    );
    body = {
      message: "verify success",
      ...codeItem,
      cc: 0,
    };
    // }
  } else {
    body = {
      message: "query fail",
      cc: 1,
    };
  }
  ctx.body = body;
});

router.post("/smsCode/waka", async (ctx, next) => {
  const { searchNumber, ip = "", city = "" } = ctx.request.body;
  let codeItem = [];
  try {
    codeItem = await DB.find("waka", {
      value: searchNumber,
    });
  } catch (error) {
    console.log(error);
    ctx.body = {
      message: "query fail",
      cc: 1,
    };
    next();
  }

  console.log(codeItem);
  codeItem = codeItem[0];
  let body = {};
  if (codeItem && codeItem._id) {
    codeItem.queryTime ? void 0 : (codeItem.queryTime = []);
    await DB.update(
      "waka",
      { _id: DB.getObjectId(codeItem._id) },
      {
        ...(codeItem || []),
        queryTime: [
          ...codeItem.queryTime,
          {
            time: moment(new Date()).format("YYYY-MM-DD HH:mm:ss"),
            ip,
            city,
          },
        ],
      }
    );
    body = {
      message: "verify success",
      ...codeItem,
      cc: 0,
    };
  } else {
    body = {
      message: "query fail",
      cc: 1,
    };
  }
  ctx.body = body;
});

router.post("/smsCode/ilia", async (ctx, next) => {
  const { searchNumber, ip = "", city = "" } = ctx.request.body;
  let ips =
    ctx.request.headers["x-forwarded-for"] ||
    ctx.request.headers["x-real-ip"] ||
    ctx.request.ip;
  console.log("ip", ips);
  let citys = ipnet.find(ips);
  let codeItem = [];
  try {
    codeItem = await DB.find("ilia", {
      value: searchNumber,
    });
  } catch (error) {
    console.log(error);
    ctx.body = {
      message: "query fail",
      cc: 1,
    };
    next();
  }

  console.log(codeItem);
  codeItem = codeItem[0];
  let body = {};
  if (codeItem && codeItem._id) {
    codeItem.queryTime ? void 0 : (codeItem.queryTime = []);
    await DB.update(
      "ilia",
      { _id: DB.getObjectId(codeItem._id) },
      {
        ...(codeItem || []),
        queryTime: [
          ...codeItem.queryTime,
          {
            time: moment(new Date()).format("YYYY-MM-DD HH:mm:ss"),
            ip: ips,
            city:
              citys[0] == "中国"
                ? citys[1] + "省" + citys[2] + "市"
                : citys.join(""),
          },
        ],
      }
    );
    body = {
      message: "验证成功",
      ...codeItem,
      cc: 0,
    };
  } else {
    body = {
      message: "验证失败",
      cc: 1,
    };
  }
  ctx.body = body;
});

router.post("/smsCode/frax", async (ctx, next) => {
  const { searchNumber, name, email, ip = "", city = "" } = ctx.request.body;
  let codeItem = [];
  try {
    codeItem = await DB.find("frax", {
      value: searchNumber,
    });
  } catch (error) {
    console.log(error);
    ctx.body = {
      message: "query fail",
      cc: 1,
    };
    next();
  }

  codeItem = codeItem[0];
  let body = {};
  if (codeItem && codeItem._id) {
    codeItem.queryTime ? void 0 : (codeItem.queryTime = []);
    await DB.update(
      "frax",
      { _id: DB.getObjectId(codeItem._id) },
      {
        ...(codeItem || []),
        queryTime: [
          ...codeItem.queryTime,
          {
            time: moment(new Date()).format("YYYY-MM-DD HH:mm:ss"),
            ip,
            city,
            name,
            email,
          },
        ],
      }
    );
    codeItem = await DB.find("frax", {
      value: searchNumber,
    });
    body = {
      message: "success",
      ...codeItem[0],
      cc: 0,
    };
  } else {
    body = {
      message: "fail",
      cc: 1,
    };
  }
  ctx.body = body;
});

router.post("/smsCode/sps", async (ctx, next) => {
  const { searchNumber, name, email, ip = "", city = "" } = ctx.request.body;
  let codeItem = [];
  try {
    codeItem = await DB.find("sps", {
      value: searchNumber,
    });
  } catch (error) {
    console.log(error);
    ctx.body = {
      message: "query fail",
      cc: 0,
    };
    next();
  }

  codeItem = codeItem[0];
  let body = {};
  if (codeItem && codeItem._id) {
    codeItem.queryTime ? void 0 : (codeItem.queryTime = []);
    await DB.update(
      "sps",
      { _id: DB.getObjectId(codeItem._id) },
      {
        ...(codeItem || []),
        queryTime: [
          ...codeItem.queryTime,
          {
            time: moment(new Date()).format("YYYY-MM-DD HH:mm:ss"),
            ip,
            city,
            name,
            email,
          },
        ],
      }
    );
    codeItem = await DB.find("sps", {
      value: searchNumber,
    });
    body = {
      message: "success",
      ...codeItem[0],
      cc:
        codeItem[0].queryTime.length == 1
          ? 1
          : codeItem[0].queryTime.length <= 6
          ? 1
          : 2,
    };
  } else {
    body = {
      message: "fail",
      cc: 0,
    };
  }
  ctx.body = body;
});

router.post("/smsCode/spsProductInfo", async (ctx, next) => {
  const { searchNumber, name, email, ip = "", city = "" } = ctx.request.body;
  let codeItem = [];
  try {
    codeItem = await DB.find("sps", {
      productNo: searchNumber,
    });
  } catch (error) {
    console.log(error);
    ctx.body = {
      message: "query fail",
      cc: 0,
    };
    next();
  }

  codeItem = codeItem[0];
  let body = {};
  if (codeItem && codeItem._id) {
    body = {
      message: "success",
      productInfo: codeItem.productInfo,
      cc: 1,
    };
  } else {
    body = {
      message: "fail",
      cc: 0,
    };
  }
  console.log(body, "body");
  ctx.body = body;
});

router.post("/smsCode/relxQuery", async (ctx, next) => {
  const { searchNumber, ip = "", city = "" } = ctx.request.body;
  let codeItem = [];
  try {
    codeItem = await DB.find("relxQuery", {
      value: searchNumber,
    });
  } catch (error) {
    console.log("error", error);
    ctx.body = {
      message: "query fail",
      cc: 1,
    };
    next();
  }

  codeItem = codeItem[0];
  console.log(codeItem);
  let body = {};
  if (codeItem && codeItem._id && codeItem.canQuery != 1) {
    codeItem.queryTime ? void 0 : (codeItem.queryTime = []);

    await DB.update(
      "relxQuery",
      { _id: DB.getObjectId(codeItem._id) },
      {
        ...codeItem,
        queryTime: [
          ...codeItem.queryTime,
          {
            time: moment(new Date()).format("YYYY-MM-DD HH:mm:ss"),
            ip,
            city,
          },
        ],
      }
    );
    body = {
      message: "verify success",
      ...codeItem,
      cc: 0,
    };
  } else {
    body = {
      message: "query fail",
      cc: 1,
    };
  }
  ctx.body = body;
});

router.post("/smsCode/vozolQuery", async (ctx, next) => {
  const { searchNumber, ip = "", city = "" } = ctx.request.body;
  let codeItem = [];
  try {
    codeItem = await DB.find("vozol", {
      value: searchNumber,
    });
  } catch (error) {
    console.log("error", error);
    ctx.body = {
      message: "query fail",
      cc: 1,
    };
    next();
  }

  codeItem = codeItem[0];
  console.log(codeItem);
  let body = {};
  if (codeItem && codeItem._id && codeItem.canQuery != 1) {
    codeItem.queryTime ? void 0 : (codeItem.queryTime = []);

    await DB.update(
      "vozol",
      { _id: DB.getObjectId(codeItem._id) },
      {
        ...codeItem,
        queryTime: [
          ...codeItem.queryTime,
          {
            time: moment(new Date()).format("YYYY-MM-DD HH:mm:ss"),
            ip,
            city,
          },
        ],
      }
    );
    body = {
      message: "verify success",
      ...codeItem,
      cc: 0,
    };
  } else {
    body = {
      message: "query fail",
      cc: 1,
    };
  }
  ctx.body = body;
});

module.exports = router;
