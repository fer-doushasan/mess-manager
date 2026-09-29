// Production backend: the store is one JSONB row and sessions get their own table.
// Works with any PostgreSQL, e.g. a free Neon database.
const { Pool } = require("pg");

const STATE_ID = 1;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });

async function withTransaction(work) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  name: "postgres",

  async init(createInitial) {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS app_state (
        id smallint PRIMARY KEY,
        data jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash text PRIMARY KEY,
        member_id text NOT NULL,
        expires_at timestamptz NOT NULL
      );
    `);
    const existing = await pool.query("SELECT 1 FROM app_state WHERE id = $1", [STATE_ID]);
    if (!existing.rowCount) {
      await pool.query("INSERT INTO app_state (id, data) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING", [
        STATE_ID,
        createInitial()
      ]);
    }
    await pool.query("DELETE FROM sessions WHERE expires_at <= now()");
  },

  async read() {
    const result = await pool.query("SELECT data FROM app_state WHERE id = $1", [STATE_ID]);
    return result.rows[0]?.data ?? null;
  },

  // Row lock serializes concurrent updates, even across multiple server instances.
  update(updater) {
    return withTransaction(async (client) => {
      const result = await client.query("SELECT data FROM app_state WHERE id = $1 FOR UPDATE", [STATE_ID]);
      const updated = await updater(result.rows[0]?.data ?? null);
      await client.query(
        `INSERT INTO app_state (id, data, updated_at) VALUES ($1, $2, now())
         ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
        [STATE_ID, updated]
      );
      return updated;
    });
  },

  async createSession(tokenHash, memberId, expiresAt) {
    await pool.query("INSERT INTO sessions (token_hash, member_id, expires_at) VALUES ($1, $2, $3)", [
      tokenHash,
      memberId,
      expiresAt
    ]);
  },

  async getSession(tokenHash) {
    const result = await pool.query(
      "SELECT member_id, expires_at FROM sessions WHERE token_hash = $1 AND expires_at > now()",
      [tokenHash]
    );
    const row = result.rows[0];
    return row ? { memberId: row.member_id, expiresAt: row.expires_at } : null;
  },

  async deleteSession(tokenHash) {
    await pool.query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash]);
  },

  close() {
    return pool.end();
  }
};
