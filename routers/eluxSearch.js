/*
 * @Author: yb 
 * @Date: 2022-01-24 20:35:25 
 * @Last Modified by: mikey.zhaopeng
 * @Last Modified time: 2022-07-10 11:57:06
 * 对luex电子烟序列号进行查询
 */
const Router = require('koa-router');
let router = new Router({
    prefix: '/api'
});
const fs = require('fs');
const DB = require('../db/index.js');
const path = require('path');
const koaBody = require('koa-body'); //解析上传文件的插件
const moment = require('moment');

router.post('/eluxSearch/query', async (ctx, next) => {
    const { searchNumber } = ctx.request.body;
    console.log(searchNumber);
    let contents = await DB.find('eluxSearchMessage', {
        value: searchNumber,
    });
    console.log('contents', contents);
    if (contents[0]) {
        // 首次查询
        let times; // 查询次数
        let time; // 查询时间
        let params = {}; // 更新参数
        if (!contents[0].firstQueryTime) {
            time = moment(new Date()).format('YYYY-MM-DD HH:mm:ss');
            times = 1;
            contents[0].firstQueryTime = time;
            contents[0].times = 1;
        } else { // 多次查询
            times = contents[0].times/1 + 1;
        }
        if (time) {
            params.firstQueryTime = time;
        }
        params.times = times;
        
        // 入库
        let data = await DB.update('eluxSearchMessage', { "_id": DB.getObjectId(contents[0]._id) }, {
            ...params
        });
        console.log('更新', data);
    }
    let body = {};
    if (contents) {
        body = {
            message: '查询成功',
            ...contents[0],
            cc: 0
        }
    } else {
        body = {
            message: '查询失败',
            cc: 1
        }
    }
    ctx.body = body;
})



module.exports = router;