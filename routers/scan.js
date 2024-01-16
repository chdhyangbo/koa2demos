/*
 * @Author: yjb 
 * @Date: 2023-12-13 20:35:25 
 * @Last Modified by: yjb
 * @Last Modified time: 2023-12-13 20:35:25
 * 验证码
 */
const Router = require('koa-router');
const puppeteer = require('puppeteer');
let router = new Router({
  prefix: '/api'
});
const DB = require('../db/index.js');
const moment = require('moment');
const { async } = require('node-stream-zip');

const getBrand = (website) => {
  return new Promise(async (resolve, reject) => {
    const browser = await puppeteer.launch({
      headless: false,
    });

    // 使用chrome的第一个窗口进行访问
    const pages = await browser.pages();
    const page = pages[0]
    await page.goto(website, {
      waitUntil: 'networkidle2' // 等待所有接口加载完毕
    });
    // 拦截返回接口获取返回信息
    page.on('response', async (response) => {
      if (response.url().indexOf('v1') > -1) {
        let json = await response.json()
        if (json) {
          let cname = json.data.codeData?.meta?.specName;
          console.log(cname);
          resolve(cname)
        } else {
          resolve('')
        }
        await browser.close();
      }
    });
  })


  // await page.screenshot({path: 'example.png'});
}

router.post('/scan/update', async (ctx, next) => {
  const { website } = ctx.request.body;
  let codeItem = []
  try {
    codeItem = await DB.find('scan', {
      website
    })
  } catch (error) {
    console.log(error)
    ctx.body = {
      message: '查询到已有入库的网址',
      cc: 1
    }
    next();
  }
  console.log(codeItem)
  codeItem = codeItem[0]
  let body = {}
  if (!codeItem) {
    // 调用爬虫，查询时候到品牌
    let cname = await getBrand(website)
    if (cname) {
      let brandDetail = {
        cname, //品牌名称
        website, // 网址
      }
      await DB.insert('scan', brandDetail);
      body = {
        message: '入库成功',
        ...brandDetail,
        cc: 0
      };
    } else {
      body = {
        message: '入库失败',
        cc: 1
      }
    }

  } else {
    body = {
      message: '数据库已存在相同网址，无需重复添加',
      cc: 1
    }
  }
  ctx.body = body
})


module.exports = router;