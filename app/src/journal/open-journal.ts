import { openDatabaseAsync, type SQLiteDatabase } from "expo-sqlite";

import { prepareJournal } from "@/journal/entries";
import type { Sql, SqlValue } from "@/journal/sql";

let opening: Promise<Sql> | null = null;

export function openJournal(): Promise<Sql> {
  if (opening === null) {
    opening = openDatabaseAsync("journal.db").then(async (db) => {
      const sql = expoSql(db);
      await prepareJournal(sql);
      return sql;
    });
  }
  return opening;
}

function expoSql(db: SQLiteDatabase): Sql {
  return {
    exec(source) {
      return db.execAsync(source);
    },
    async run(source, params = []) {
      await db.runAsync(source, params);
    },
    all<T>(source: string, params: SqlValue[] = []) {
      return db.getAllAsync<T>(source, params);
    },
    async get<T>(source: string, params: SqlValue[] = []) {
      const row = await db.getFirstAsync<T>(source, params);
      return row ?? null;
    },
  };
}
