let mongoose = require('mongoose');

let Users = mongoose.model('users', new mongoose.Schema({  
    usernaem: String,   
    password: String
},{_id:true}));

module.exports =  Users;