const Router = require('koa-router');
let router = new Router({
    prefix: '/api'
});
const fs = require('fs');
const DB = require('../db/index.js');
const path = require('path');
const koaBody = require('koa-body'); //解析上传文件的插件
const nameMap = [
    '密码',
    '用户名称',
    '手机号',
    '邮箱',
]
// 注册账户
// 登录操作
router.post('/regist',async (ctx, next) => { 
    console.log(ctx.request.body);
    let { password, username, phone, email } = ctx.request.body;
    let name = [password, username, phone, email].indexOf('');
    if (name > -1) {
        ctx.body = {
            message: `${nameMap[name]}还未填写！`,
            cc: 1,
            errorCode: 1,
        }
        return
    }
    // 获取表单提交的数据
    let data = await DB.find('user', {'username': ctx.request.body.username});
    console.log('registedata', data);
    if(data && data.length > 0){
        ctx.body = {
            message: '该用户名已经存在，请重新输入',
            cc: 1,
            errorCode: 1,
        }
        return
    }
    // 如果没有就插入
    let insertData = await DB.insert('user', {
        username, 
        password,
        phone,
        email,
    });

    try{
        if(insertData.acknowledged){
            ctx.body = {
                message: '注册用户成功',
                cc: 0
            }
        }
    }catch(err){
        ctx.body = {
            message: '注册用户失败，请重新注册',
            cc: 1
        }
    }
    await next()
})


module.exports = router;