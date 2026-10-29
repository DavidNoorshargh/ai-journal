export type SqlValue = string | number | null;

export type Sql = {
  exec(source: string): Promise<void>;
  run(source: string, params?: SqlValue[]): Promise<void>;
  all<T>(source: string, params?: SqlValue[]): Promise<T[]>;
  get<T>(source: string, params?: SqlValue[]): Promise<T | null>;
};
