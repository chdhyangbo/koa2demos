// 引入MongoDB数据库模块
const  MongoDB = require('mongodb');
// 获得数据库客户端
const  MongoClient = MongoDB.MongoClient;
// 引入mongoose
const mongoose = require('mongoose');
// 获取操作数据库ID的方法
const  ObjectID = MongoDB.ObjectID;
// 引入数据库的配置文件
const  Config = require('../config/db.js');
const url = Config.dbUrl+Config.dbName;

const options = {
    connectTimeoutMS: 5000, // 设置连接超时时间为5秒
};
 
class DB{
    // 单例模式，解决多次实例化实例不共享的问题
    static getInstance(){   
        if(!DB.instance){
            DB.instance=new DB();
        }
        return  DB.instance;
    }
    constructor(){
        this.dbClient=''; 
        // 实例化的时候就连接数据库，解决第一次查询太久的问题
        this.connect();   
    }
    // 连接数据库
    connect(){  
        let that=this;
        return new Promise((resolve,reject)=>{
            //  解决数据库多次连接的问题
<<<<<<< HEAD
            if(!that.dbClient){   
=======
            if(!that.dbClient){    
>>>>>>> a8b82175111393832348f89575c98125d86d8938
                MongoClient.connect(Config.dbUrl, (err,client)=>{
                    if(err){
                        console.log('链接数据库失败')
                        reject(err)
                    }else{
                        console.log('链接数据库成功')
                        that.dbClient=client.db(Config.dbName);
                        resolve(that.dbClient)
                    }
                })
                // console.log(MongoClient, 'xxxx');
                // mongoose.connect(Config.dbUrl).then(() => {
                //     console.log('success');
                // }).catch((err) => {
                //     console.log('fail');
                // })
            }else{
                resolve(that.dbClient);
            }
        })
    }
    // 查找方法
    find(collectionName,json){
        return new Promise((resolve,reject)=>{
            this.connect().then((db)=>{
                var result=db.collection(collectionName).find(json);
                result.toArray(function(err,doc){
                    if(err){
                        reject(err);
                        return;
                    }
                    resolve(doc);
                })
 
            })
        })
    }
    // 更新方法
    update(collectionName,oldJson,newJson){
        return new Promise((resolve,reject)=>{
            this.connect().then((db)=>{
                db.collection(collectionName).updateOne(oldJson,{
                    $set:newJson
                },(err,result)=>{
                    if(err){
                        reject(err);
                    }else{
                        resolve(result);
                    }
                })
            })
        })
    }
    // 插入数据
    insert(collectionName,json){
        return new  Promise((resolve,reject)=>{
            this.connect().then((db)=>{
                db.collection(collectionName).insertOne(json,function(err,result){
                    if(err){
                        reject(err);
                    }else{
                        resolve(result);
                    }
                })
            })
        })
    }
    // 删除数据
    remove(collectionName,json){
        return new  Promise((resolve,reject)=>{
            this.connect().then((db)=>{
                db.collection(collectionName).remove(json,function(err,result){
                    if(err){
                        reject(err);
                    }else{
                        resolve(result);
                    }
                })
            })
        })
    }
    // mongodb里面查询_id需要把字符串转换成对象
    getObjectId(id){    
        return new ObjectID(id);
    }
}
 
 
module.exports = DB.getInstance();