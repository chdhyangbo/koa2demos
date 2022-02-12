/*
 * @Author: yb 
 * @Date: 2022-01-24 20:35:25 
 * @Last Modified by: yb
 * @Last Modified time: 2022-02-10 21:55:09
 * 时间导航栏增删改查
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

router.post('/user/query', async (ctx, next) => {
    const { username } = ctx.request.body;
    console.log(username);
    let contents = await DB.find('user', {
        username,
    });
    console.log('contents', contents);
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


// 新增用户
router.post('/user/save', async (ctx, next) => {
    let { username, phone, password, email} = ctx.request.body;
    let data = await DB.insert('user', {
        username,
        phone,
        password,
        email,
        time: moment(new Date()).format('YYYY-MM-DD HH:mm:ss'),
    });
    console.log(data);
    try {
        if (data.acknowledged) {
            body = {
                message: '新增成功',
                cc: 0
            }
        }
    } catch (err) {
        body = {
            message: '新增失败，请重试',
            cc: 1
        }
    }
    // 获取表单提交的数据
    console.log('新增情况', body)
    ctx.body = body;
    await next();
})

// 删除用户
router.post('/user/delete', async (ctx) => {
    let id = ctx.request.body.id;
    if (!id) {
        body = {
            message: '删除的数据没有id',
            cc: 1
        }
        return;
    }
    let data = await DB.remove('user', { "_id": DB.getObjectId(id) });
    console.log(data);
    try {
        if (data.acknowledged) {
            ctx.body = {
                message: '删除成功',
                cc: 0
            }
        }
    } catch (err) {
        ctx.body = {
            message: '删除失败',
            cc: 1
        }
    }
})

// 更新内容
router.post('/user/update', async (ctx) => {
    let { id, phone, email, username, passwordOld, passwordNew } = ctx.request.body;
    console.log(id, phone, email, username);
    let params = {
        phone, 
        email, 
        username,
        updateTime: moment(new Date()).format('YYYY-MM-DD HH:mm:ss'),
    }
    if (passwordOld && passwordNew) {
        // 单独修改个人密码的接口
        if (passwordOld == passwordNew) {
            ctx.body = {
                message: '修改失败, 新密码不能和旧密码相同',
                cc: 1
            }
            return 
        }

        // 旧密码和服务器的旧密码不同
        let contents = await DB.find('user', {
            "_id": DB.getObjectId(id)
        })
        if (contents[0].password !== passwordOld) {
            ctx.body = {
                message: '修改失败, 旧密码错误',
                cc: 1
            }
            return 
        }

        // 使用新密码
        params.password = passwordNew;
    }
    let data = await DB.update('user', { "_id": DB.getObjectId(id) }, {
        ...params
    });
    console.log(data);
    try {
        if (data.acknowledged) {
            ctx.body = {
                message: '更新成功',
                cc: 0
            }
        }
    } catch (err) {
        ctx.body = {
            message: '更新失败',
            cc: 1
        }
    }
})


module.exports = router;