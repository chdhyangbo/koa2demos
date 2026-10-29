/**
 * 生成角色测试账户。
 *
 * 用法：
 *   node scripts/generateRoleTestAccounts.js
 *   node scripts/generateRoleTestAccounts.js --count=100
 *   node scripts/generateRoleTestAccounts.js --count=100 --prefix=rt
 *
 * 默认生成 100 个账户，密码只以 scrypt 哈希形式写入 MongoDB，
 * 明文账户密码会输出到 scripts/generated/*.csv，方便分发。
 * 该目录已加入 .gitignore，请勿把生成的文件提交到仓库。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const DB = require('../db/index.js');
const { hashSecret } = require('../utils/password');

const COLLECTION = 'roleTestAccounts';
const MAX_SUBMISSIONS = 3;
const OUTPUT_DIR = path.join(__dirname, 'generated');
const USERNAME_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const PASSWORD_ALPHABET =
  'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

function readArg(name, fallback) {
  const prefix = `--${name}=`;
  const direct = process.argv.find((item) => item.startsWith(prefix));
  if (direct) return direct.slice(prefix.length);

  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return fallback;
}

function randomString(length, alphabet) {
  let result = '';
  for (let index = 0; index < length; index += 1) {
    result += alphabet[crypto.randomInt(0, alphabet.length)];
  }
  return result;
}

function randomPassword(length = 12) {
  for (;;) {
    const value = randomString(length, PASSWORD_ALPHABET);
    if (/[A-Z]/.test(value) && /[a-z]/.test(value) && /[0-9]/.test(value)) {
      return value;
    }
  }
}

function timestamp() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('');
}

function printHelp() {
  console.log(`
角色测试账户生成器

  node scripts/generateRoleTestAccounts.js [--count=100] [--prefix=rt]

  --count    生成数量，默认 100，范围 1-1000
  --prefix   账户前缀，默认 rt，仅支持字母、数字、下划线

生成后会：
  1. 把账户写入 MongoDB 的 ${COLLECTION} 集合（密码为 scrypt 哈希）
  2. 在 scripts/generated/ 下输出 CSV 明文账户密码
`);
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printHelp();
    return;
  }

  const count = Number(readArg('count', 100));
  const prefix = String(readArg('prefix', 'rt')).trim().toLowerCase();

  if (!Number.isInteger(count) || count < 1 || count > 1000) {
    throw new Error('--count 必须是 1-1000 之间的整数');
  }
  if (!/^[a-z0-9_]{1,12}$/.test(prefix)) {
    throw new Error('--prefix 仅支持 1-12 位字母、数字或下划线');
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log(`[RoleTest] 正在读取已有账户...`);
  const existing = await DB.find(COLLECTION, {});
  const occupied = new Set((existing || []).map((item) => item.username));

  const batchId = `rt-${Date.now()}`;
  const createdAt = Date.now();
  const accounts = [];

  while (accounts.length < count) {
    const username = `${prefix}_${randomString(8, USERNAME_ALPHABET)}`;
    if (occupied.has(username)) continue;
    occupied.add(username);
    accounts.push({ username, password: randomPassword(12) });
  }

  console.log(`[RoleTest] 正在写入 ${count} 个账户到 MongoDB...`);
  for (let index = 0; index < accounts.length; index += 1) {
    const account = accounts[index];
    await DB.insert(COLLECTION, {
      username: account.username,
      passwordHash: hashSecret(account.password),
      usedCount: 0,
      maxSubmissions: MAX_SUBMISSIONS,
      batchId,
      createdAt,
    });
    if ((index + 1) % 10 === 0) {
      console.log(`[RoleTest] 已写入 ${index + 1}/${count}`);
    }
  }

  const fileName = `roleTestAccounts-${timestamp()}.csv`;
  const filePath = path.join(OUTPUT_DIR, fileName);
  const csv = ['username,password']
    .concat(accounts.map((account) => `${account.username},${account.password}`))
    .join('\n');
  fs.writeFileSync(filePath, `${csv}\n`, 'utf8');

  console.log('');
  console.log(`[RoleTest] 生成完成：${count} 个账户`);
  console.log(`[RoleTest] 批次：${batchId}`);
  console.log(`[RoleTest] 名单：${filePath}`);
  console.log(`[RoleTest] 每个账户可提交 ${MAX_SUBMISSIONS} 次`);
  console.log('');
  console.log('前 5 个账户：');
  accounts.slice(0, 5).forEach((account) => {
    console.log(`  ${account.username}  ${account.password}`);
  });
  console.log('');
  console.log('请妥善保管 CSV 文件，该目录已加入 .gitignore。');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(`[RoleTest] 生成失败：${error.message}`);
    process.exit(1);
  });
