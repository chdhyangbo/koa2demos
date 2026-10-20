const Router = require('koa-router');
let router = new Router({ prefix: '/api/usage' });
const DB = require('../db/index.js');

const ENV_LIMIT = parseInt(process.env.CONVERT_DAILY_LIMIT || '10');

function today() {
    return new Date().toISOString().split('T')[0];
}

async function getDefaultLimit() {
    const config = await DB.find('config', { key: 'convertDailyLimit' });
    if (config && config.length > 0 && config[0].value) return config[0].value;
    return ENV_LIMIT;
}

function getRecordLimit(record) {
    return (record && record.dailyLimit) ? record.dailyLimit : null;
}

router.post('/list', async (ctx) => {
    let data = await DB.find('usage', {});
    ctx.body = data || [];
});

router.post('/update', async (ctx) => {
    const { userId, dailyLimit } = ctx.request.body;
    if (!userId || dailyLimit === undefined) {
        ctx.body = { cc: 1, message: '缺少参数' };
        return;
    }
    const existing = await DB.find('usage', { userId });
    if (existing && existing.length > 0) {
        await DB.update('usage', { userId }, { dailyLimit: Number(dailyLimit) });
    } else {
        await DB.insert('usage', { userId, dailyLimit: Number(dailyLimit), convertCount: 0, convertDate: '', downloadCount: 0, downloadDate: '' });
    }
    ctx.body = { cc: 0, message: '更新成功' };
});

router.get('/check', async (ctx) => {
    const { userId } = ctx.query;
    if (!userId) { ctx.body = { cc: 1, message: '缺少 userId' }; return; }
    const usage = await DB.find('usage', { userId });
    const def = await getDefaultLimit();
    if (!usage || usage.length === 0) {
        ctx.body = { cc: 0, remaining: def, dailyLimit: def };
        return;
    }
    const record = usage[0];
    const limit = getRecordLimit(record) || def;
    if (record.convertDate !== today()) {
        ctx.body = { cc: 0, remaining: limit, dailyLimit: limit };
    } else {
        ctx.body = { cc: 0, remaining: Math.max(0, limit - (record.convertCount || 0)), dailyLimit: limit };
    }
});

router.post('/convert', async (ctx) => {
    const { userId } = ctx.request.body;
    if (!userId) { ctx.body = { cc: 1, message: '缺少 userId' }; return; }
    const def = await getDefaultLimit();
    const usage = await DB.find('usage', { userId });
    let limit = def;
    if (usage && usage.length > 0) limit = getRecordLimit(usage[0]) || def;
    if (!usage || usage.length === 0) {
        await DB.insert('usage', { userId, convertCount: 1, convertDate: today(), downloadCount: 0, downloadDate: '', dailyLimit: def });
        ctx.body = { cc: 0, convertCount: 1, dailyLimit: def };
        return;
    }
    const record = usage[0];
    if (record.convertDate !== today()) {
        await DB.update('usage', { userId }, { convertCount: 1, convertDate: today() });
        ctx.body = { cc: 0, convertCount: 1, dailyLimit: record.dailyLimit || limit };
    } else if ((record.convertCount || 0) >= limit) {
        ctx.body = { cc: 1, message: `今日转换次数已用完（上限${limit}次）` };
    } else {
        await DB.update('usage', { userId }, { convertCount: (record.convertCount || 0) + 1 });
        ctx.body = { cc: 0, convertCount: (record.convertCount || 0) + 1, dailyLimit: record.dailyLimit || limit };
    }
});

router.post('/download', async (ctx) => {
    const { userId } = ctx.request.body;
    if (!userId) { ctx.body = { cc: 1, message: '缺少 userId' }; return; }
    const def = await getDefaultLimit();
    const usage = await DB.find('usage', { userId });
    if (!usage || usage.length === 0) {
        await DB.insert('usage', { userId, convertCount: 0, convertDate: '', downloadCount: 1, downloadDate: today(), dailyLimit: def });
        ctx.body = { cc: 0, downloadCount: 1 };
        return;
    }
    const record = usage[0];
    if (record.downloadDate !== today()) {
        await DB.update('usage', { userId }, { downloadCount: 1, downloadDate: today() });
        ctx.body = { cc: 0, downloadCount: 1 };
    } else {
        await DB.update('usage', { userId }, { downloadCount: (record.downloadCount || 0) + 1 });
        ctx.body = { cc: 0, downloadCount: (record.downloadCount || 0) + 1 };
    }
});

module.exports = router;
