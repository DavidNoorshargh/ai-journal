export const TAGS = ["life", "work", "thoughts", "learnings"] as const;

export type Tag = (typeof TAGS)[number];
