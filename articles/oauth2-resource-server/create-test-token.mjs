import { generateKeyPairSync, sign } from 'node:crypto';
import { writeFileSync } from 'node:fs';

// 在独立空目录运行：每次生成一对新的测试密钥，不覆盖已有文件。
const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const now = Math.floor(Date.now() / 1000);
const encodeJson = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const header = encodeJson({ alg: 'RS512', typ: 'JWT' });
const payload = encodeJson({ sub: 'allurx', iat: now, exp: now + 600 });
const signingInput = `${header}.${payload}`;
const signature = sign('RSA-SHA512', Buffer.from(signingInput), privateKey).toString('base64url');

// 私钥仅留在本地签发目录；资源服务器只需要 key.public。
writeFileSync('key.private', privateKey, { flag: 'wx', mode: 0o600 });
writeFileSync('key.public', publicKey, { flag: 'wx' });
writeFileSync('access-token.txt', `${signingInput}.${signature}`, { flag: 'wx', mode: 0o600 });
console.log('已生成测试公私钥与有效期为 10 分钟的 RS512 令牌。');
