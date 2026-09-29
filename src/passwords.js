const crypto = require("node:crypto");
const { promisify } = require("node:util");

const scrypt = promisify(crypto.scrypt);
const KEY_LENGTH = 64;
const PREFIX = "scrypt";

function isHashed(value) {
  return typeof value === "string" && value.startsWith(`${PREFIX}$`);
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(password), salt, KEY_LENGTH).toString("hex");
  return `${PREFIX}$${salt}$${hash}`;
}

async function verifyPassword(password, stored) {
  if (!isHashed(stored) || !password) {
    return false;
  }
  const [, salt, hash] = stored.split("$");
  const expected = Buffer.from(hash, "hex");
  const actual = await scrypt(String(password), salt, expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

module.exports = {
  hashPassword,
  isHashed,
  verifyPassword
};
