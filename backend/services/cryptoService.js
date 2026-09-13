const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';

function getKey() {
  const secret = process.env.ENCRYPTION_KEY;

  if (!secret) {
    throw new Error('ENCRYPTION_KEY não configurada.');
  }

  return crypto
    .createHash('sha256')
    .update(secret)
    .digest();
}

function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const key = getKey();

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(text, 'utf8'),
    cipher.final()
  ]);

  const authTag = cipher.getAuthTag();

  return [
    iv.toString('hex'),
    authTag.toString('hex'),
    encrypted.toString('hex')
  ].join(':');
}

function decrypt(data) {
  const [ivHex, authTagHex, encryptedHex] = data.split(':');

  const key = getKey();

  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(ivHex, 'hex')
  );

  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedHex, 'hex')),
    decipher.final()
  ]);

  return decrypted.toString('utf8');
}

module.exports = {
  encrypt,
  decrypt
};
