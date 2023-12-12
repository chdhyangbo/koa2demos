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
const geoip = require('geoip-lite');

router.post('/antiSearch/query', async (ctx, next) => {
    const { searchNumber } = ctx.request.body;
    const ip = ctx.request.ip;
    let area = geoip.lookup(ip);
    const city = area?.city + ' City,' + area?.region + ' Province, ' + area?.country;
    console.log(searchNumber);
    let contents = await DB.find('antiSearchMessage', {
        value: searchNumber,
    });
    let time = moment(new Date()).format('YYYY/MM/DD HH:mm:ss'); // 查询时间
    let times; // 查询次数

    console.log('contents', contents);
    if (contents[0]) {
        // 首次查询
        let params = {}; // 更新参数
        if (!contents[0].queryTime) {
            times = 1;
            params.queryTime = [{ time, ip, city }];
            contents[0].queryTime = [{ time, ip, city }];
            contents[0].times = 1;

        } else { // 多次查询
            times = contents[0].times / 1 + 1;
            contents[0].queryTime.push({ time, ip, city })
            params.queryTime = contents[0].queryTime;
        }

        params.times = times;

        // 入库
        let data = await DB.update('antiSearchMessage', { "_id": DB.getObjectId(contents[0]._id) }, {
            ...params
        });
        console.log('更新', data);
    }
    let body = {};
    if (contents.length > 0) {
        let recordList = contents[0].queryTime.map(item => {
            return {
                "ID": 1,
                "Status": "合法",
                "FwCode": searchNumber,
                "QueryTime": item.time,
                "Address": item.city,
                "WxNickName": "",
                "WxHeadImg": "",
                "WxSex": "          ",
                "From": "IP:"+ item.ip
            }
        })
        if (times > 100) {
            body = {
                cc: 0,
                message: '查询成功',
                "RecordList": recordList,
                "State": 4,
                "IsColor": false,
                "QueryContent": "The anti-counterfeiting code has been queried many times, beware of counterfeiting!",
                "ColorValueSet": "",
                "ColorName": null,
                "ColorValue": null,
                "ColorTone": 0,
                "CompanyName": "Aroma Family ltd",
                "BarcodeImg": "",
                "TxtureImg": "",
                "WebSite": "",
                "Tel": "",
                "Times": times,
                "FirstDate": contents[0].queryTime[0].time,
                "TagImg": "\cp.png",
                "BrandImg": "\logo.png",
                "BarCode": searchNumber,
                "FlowWaterCode": "",
                "FlowWaterImg": "",
                "From": ip,
                "InspecCode": "",
                "InspecIndex": 0,
                "BrandName": "AROMA KING",
                "ExpUrl": "",
                "CodeIndex": 0,
                "Fingerprint": "",
            }
        } else {
            body = {
                message: '查询成功',
                cc: 0,
                "RecordList": recordList,
                "State": 1,
                "IsColor": false,
                "QueryContent": `The security code you have queried has been queried ${contents[0].queryTime.length}Times,First query Beijing-Time:${contents[0].queryTime[0].time},IP:${contents[0].queryTime[0].ip},Please confirm.Warning: If this time period is not my query, beware of counterfeiting!`,
                "ColorValueSet": "",
                "ColorName": null,
                "ColorValue": null,
                "ColorTone": 0,
                "CompanyName": "Aroma Family ltd",
                "BarcodeImg": "",
                "TxtureImg": "",
                "WebSite": "",
                "Tel": "",
                "Times": 2,
                "FirstDate": contents[0].queryTime[0].time,
                "TagImg": "/cp.png",
                "BrandImg": "/logo.png",
                "BarCode": searchNumber,
                "FlowWaterCode": "",
                "FlowWaterImg": "",
                "From": "IP:" + ip,
                "InspecCode": "",
                "InspecIndex": 0,
                "BrandName": "AROMA KING",
                "ExpUrl": "",
                "CodeIndex": 5344875,
                "Fingerprint": ""
            }
        }
    } else {
        body = {
            message: '查询失败',
            "RecordList": [],
            "State": 0,
            "IsColor": false,
            "QueryContent": "The security code you are looking for does not exist. Beware of counterfeiting! Or contact the company\u0027s customer service staff!",
            "ColorValueSet": "",
            "ColorName": null,
            "ColorValue": null,
            "ColorTone": 0,
            "CompanyName": "Aroma Family ltd",
            "BarcodeImg": "",
            "TxtureImg": "",
            "WebSite": "",
            "Tel": "",
            "Times": 0,
            "FirstDate": time,
            "TagImg": "\cp.png",
            "BrandImg": "\logo.png",
            "BarCode": searchNumber,
            "FlowWaterCode": "",
            "FlowWaterImg": "",
            "From": ip,
            "InspecCode": "",
            "InspecIndex": 0,
            "BrandName": "AROMA KING",
            "ExpUrl": "",
            "CodeIndex": 0,
            "Fingerprint": "",
            cc: 0
        }
    }
    ctx.body = body;
})



module.exports = router;