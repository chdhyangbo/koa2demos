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

router.post('/smsCode/query', async (ctx, next) => {
  const { searchNumber, ip, city } = ctx.request.body;
  if (searchNumber && searchNumber.length != 14) {
    ctx.body = {
      message: '参数异常'
    }
  }
  let codeItem = await DB.find('smsCode', {
    value: searchNumber
  })
  codeItem = codeItem[0]
  console.log(codeItem, '>>>>');
  if (codeItem && codeItem._id) {
    await DB.update('smsCode', { "_id": DB.getObjectId(codeItem._id) }, {
      ...codeItem,
      queryTime: [
        ...codeItem.queryTime,
        {
          time: moment(new Date()).format('YYYY-MM-DD HH:mm:ss'),
          ip,
          city
        }
      ]
    });
  }else {
    // await DB.insert('smsCode', {
    //   value: searchNumber,
    //   queryTime:[{
    //     time: moment(new Date()).format('YYYY-MM-DD HH:mm:ss'),
    //     ip,
    //     city
    //   }]
    // })
    ctx.body = {
      message: '查不到该产品信息'
    }
  }
  ctx.body = {
    message: '校验成功'
  };
})

module.exports = router;