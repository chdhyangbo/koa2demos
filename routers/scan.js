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

const getBrand = async (website) => {
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1440, height: 1000 },
    ignoreHTTPSErrors: true,
    args: [`--window-size=${1440},${1000}`], // new option
  });
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  // page.on('request', request => {

  //   request.continue();
  // });

  page.on("response", response => {
    if (response.url().indexOf('v1') > -1) {
      console.log(response.url())
      console.log(response)
    }
  })

  await page.goto(website);


  // await page.screenshot({path: 'example.png'});
  // await browser.close();
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
    let brandDetail = {
      cname, //品牌名称
      website, // 网址
    }
    // await DB.insert('scan', brandDetail);
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
  ctx.body = body
})


module.exports = router;