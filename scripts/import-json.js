// Copies a JSON store (default: data/store.json) into the PostgreSQL database in DATABASE_URL.
// This replaces whatever the database currently holds. Plain-text passwords are hashed on the way in.
const fs = require("node:fs");
const path = require("node:path");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Add it to .env or pass it on the command line.");
  process.exit(1);
}

const { backend, initStore, normalizeStore } = require("../src/store");

async function main() {
  const file = path.resolve(process.argv[2] || path.join(__dirname, "..", "data", "store.json"));
  const data = normalizeStore(JSON.parse(fs.readFileSync(file, "utf8")));

  await backend.init(() => data);
  await backend.update(() => data);
  await initStore();

  const active = data.members.filter((member) => member.active !== false).length;
  console.log(`Imported ${file}: ${active} active members, ${data.bazarEntries.length} bazar entries.`);
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => backend.close());
