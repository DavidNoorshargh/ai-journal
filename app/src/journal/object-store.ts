export type ObjectStore = {
  put(key: string, text: string): Promise<void>;
  remove(key: string): Promise<void>;
};
