# 数据库启用
以后写成脚本，自动启动
## 开发环境
进入mongodb的bin库那里,并且更换默认端口为8091,规避漏洞
mongod --dbpath D:\study\basedb --port 8091
databasename(仓库名称): baseDB 

安装nodemon后进行启动
```
npm install -g nodemon

npm run dev
```
## 生产环境
```
npm run prod
```


# 表
## 用户表[user]
|  字段    |   中文名  | 备注  |
|:--------:|:--------:|:------:|
| username | 用户名称  |   |
| password | 密码  |   |
|  openId  | 各个渠道的id  |   |
|  isFirst | 非正常注册账号  |   |
|   phone  | 手机号  |   |
| fromWay  | 渠道简称  | WX-微信 空-PC端 |
| role | 角色数组 | 数字越小，权限越大 |

# 前端打包
前端打包后的文件放在static里面