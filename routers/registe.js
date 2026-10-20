const Router = require('koa-router');
let router = new Router({
    prefix: '/api'
});
const crypto = require('crypto');
const { ObjectID } = require('mongodb');
const DB = require('../db/index.js');
const nameMap = [
    '密码',
    '用户名称',
    '手机号',
    '邮箱',
]

router.post('/regist',async (ctx, next) => { 
    let { password, username, phone, email } = ctx.request.body;
    let name = [password, username, phone, email].indexOf('');
    if (name > -1) {
        ctx.body = { message: `${nameMap[name]}还未填写！`, cc: 1, errorCode: 1 }
        return
    }
    let data = await DB.find('user', { 'username': username });
    if(data && data.length > 0){
        ctx.body = { message: '该用户名已经存在，请重新输入', cc: 1, errorCode: 1 }
        return
    }
    if (phone) {
        let phoneData = await DB.find('user', { phone });
        if (phoneData && phoneData.length > 0) {
            ctx.body = { message: '该手机号已被注册', cc: 1, errorCode: 1 }
            return
        }
    }
    let insertData = await DB.insert('user', {
        username,
        password,
        phone,
        email,
        passwordUpdatedAt: new Date()
    });
    try{
        if(insertData.acknowledged){
            let userId = insertData.insertedId.toString();
            await DB.update('user', { _id: new ObjectID(userId) }, { userId });
            ctx.body = { message: '注册用户成功', cc: 0, userId }
        }
    }catch(err){
        ctx.body = { message: '注册用户失败，请重新注册', cc: 1 }
    }
    await next()
})


module.exports = router;