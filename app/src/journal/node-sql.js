const { DatabaseSync } = require("node:sqlite");

function nodeSql() {
  const db = new DatabaseSync(":memory:");
  return {
    async exec(source) {
      db.exec(source);
    },
    async run(source, params = []) {
      db.prepare(source).run(...params);
    },
    async all(source, params = []) {
      return db.prepare(source).all(...params);
    },
    async get(source, params = []) {
      const row = db.prepare(source).get(...params);
      return row ?? null;
    },
  };
}

module.exports = { nodeSql };
