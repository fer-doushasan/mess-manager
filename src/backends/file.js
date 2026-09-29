// Local development backend: the whole store lives in one JSON file and
// sessions live in memory. Used when DATABASE_URL is not set.
const fs = require("node:fs/promises");
const path = require("node:path");

const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, "..", "..", "data", "store.json");

const sessions = new Map();
let queue = Promise.resolve();

async function readFile() {
  try {
    return JSON.parse(await fs.readFile(DATA_FILE, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function writeFile(data) {
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  const tempFile = `${DATA_FILE}.${process.pid}.tmp`;
  await fs.writeFile(tempFile, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await fs.rename(tempFile, DATA_FILE);
}

module.exports = {
  name: `file (${DATA_FILE})`,

  async init(createInitial) {
    await this.update((data) => data ?? createInitial());
  },

  read: readFile,

  // Updates run one at a time so concurrent requests cannot overwrite each other.
  update(updater) {
    const run = queue.then(async () => {
      const updated = await updater(await readFile());
      await writeFile(updated);
      return updated;
    });
    queue = run.catch(() => {});
    return run;
  },

  async createSession(tokenHash, memberId, expiresAt) {
    sessions.set(tokenHash, { memberId, expiresAt });
  },

  async getSession(tokenHash) {
    const session = sessions.get(tokenHash);
    if (!session || session.expiresAt <= new Date()) {
      sessions.delete(tokenHash);
      return null;
    }
    return session;
  },

  async deleteSession(tokenHash) {
    sessions.delete(tokenHash);
  },

  async close() {}
};
