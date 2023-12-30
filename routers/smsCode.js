/*
 * @Author: yjb 
 * @Date: 2023-12-13 20:35:25 
 * @Last Modified by: yjb
 * @Last Modified time: 2023-12-13 20:35:25
 * 验证码
 */
const Router = require('koa-router');
let router = new Router({
  prefix: '/api'
});
const DB = require('../db/index.js');
const moment = require('moment');
const { async } = require('node-stream-zip');

router.post('/smsCode/query', async (ctx, next) => {
  const { searchNumber, ip = '', city = '' } = ctx.request.body;
 
  let codeItem = await DB.find('smsCode', {
    value: searchNumber
  })
  console.log(codeItem)
  codeItem = codeItem[0]
  let body = {}
  if (codeItem && codeItem._id) {
    await DB.update('smsCode', { "_id": DB.getObjectId(codeItem._id) }, {
      ...codeItem,
      queryTime: [
        ...codeItem.queryTime,
        {
          time: moment(new Date()).format('YYYY-MM-DD HH:mm:ss'),
          ip,
          city,
        }
      ]
    });
    body = {
      message: '校验成功',
      ...codeItem,
      cc: 0
    };
  } else {
    body = {
      message: '查询失败',
      cc: 1
    }
  }
  ctx.body = body
})

router.post('/smsCode/voodooQuery', async (ctx, next) => {
  const { searchNumber, ip = '', city = '' } = ctx.request.body;

  let codeItem = await DB.find('voodooSmsCode', {
    value: searchNumber
  })
  console.log(codeItem)
  codeItem = codeItem[0]
  let body = {}
  if (codeItem && codeItem._id) {
    await DB.update('voodooSmsCode', { "_id": DB.getObjectId(codeItem._id) }, {
      ...codeItem,
      queryTime: [
        ...codeItem.queryTime,
        {
          time: moment(new Date()).format('YYYY-MM-DD HH:mm:ss'),
          ip,
          city,
        }
      ]
    });
    body = {
      message: '校验成功',
      ...codeItem,
      cc: 0
    };
  } else {
    body = {
      message: '查询失败',
      cc: 1
    }
  }
  ctx.body = body
})


router.post('/smsCode/elfp', async (ctx, next) => {
  const { searchNumber, ip = '', city = '' } = ctx.request.body;

  let codeItem = await DB.find('elfpSmsCode', {
    value: searchNumber
  })
  console.log(codeItem)
  codeItem = codeItem[0]
  let body = {}
  if (codeItem && codeItem._id) {
    await DB.update('elfpSmsCode', { "_id": DB.getObjectId(codeItem._id) }, {
      ...codeItem,
      queryTime: [
        ...codeItem.queryTime,
        {
          time: moment(new Date()).format('YYYY-MM-DD HH:mm:ss'),
          ip,
          city,
        }
      ]
    });
    body = {
      message: '校验成功',
      ...codeItem,
      cc: 0
    };
  } else {
    body = {
      message: '查询失败',
      cc: 1
    }
  }
  ctx.body = body
})

module.exports = router;