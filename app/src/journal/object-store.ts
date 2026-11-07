export type ObjectStore = {
  put(key: string, text: string): Promise<void>;
  remove(key: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
  get(key: string): Promise<string | null>;
};
