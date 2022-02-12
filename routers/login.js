const Router = require('koa-router');
let router = new Router({
    prefix: '/api'
});
const DB = require('../db/index.js');
const jwt = require('jsonwebtoken')

// 登录操作
router.post('/login',async (ctx, next) => { 
    console.log(ctx.request.body);
    // 获取表单提交的数据
    // await DB.insert('user', {username: 'ybadmin', password:'ybadmin'});
    let data = await DB.find('user', {'username': ctx.request.body.username});
    console.log('logindata', data);
    try{
        if(data && data.length > 0 && ctx.request.body.password == data[0].password){
            let payload = {
                username: ctx.request.body.username,
                phone: data[0].phone,
                email: data[0].email,
                time: new Date().getTime(),
                timeout: 1000*24*60*60
            }
            let token = jwt.sign(payload, 'ybadmin')
            ctx.body = {
                message: '登录成功',
                cc: 0,
                isFirst: data[0].isFirst,
                token,
            }
        } else {
            ctx.body = {
                message: '用户名或密码错误',
                cc: 1
            }
        }
    }catch(err){
        ctx.body = {
            message: '登录失败',
            cc: 1
        }
    }
    await next()
})


module.exports = router;