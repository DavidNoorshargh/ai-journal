import { aws } from "@/aws";
import type { Entry } from "@/journal/entries";
import { authorizedHeaders, type AwsCredentials } from "@/journal/s3";

export type UnsyncedEntry = {
  id: string;
  date: string;
  title: string;
  body: string;
  tags: string[];
};

export type AskBody = {
  question: string;
  unsyncedEntries: UnsyncedEntry[];
};

export type AgentReply = {
  answer: string;
  entryIds: string[];
};

type AgentResponse = {
  ok: boolean;
  text: () => Promise<string>;
};

type Post = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<AgentResponse>;

export function askBody(question: string, entries: readonly Entry[]): AskBody {
  return {
    question: question.trim(),
    unsyncedEntries: unsyncedEntries(entries),
  };
}

function unsyncedEntries(entries: readonly Entry[]): UnsyncedEntry[] {
  return entries.filter(stillOnPhone).map(unsyncedEntry);
}

function stillOnPhone(entry: Entry): boolean {
  return entry.syncState !== "uploaded";
}

function unsyncedEntry(entry: Entry): UnsyncedEntry {
  return {
    id: entry.id,
    date: entry.date,
    title: entry.title,
    body: entry.body,
    tags: [...entry.tags],
  };
}

export function runtimeSessionId(random: () => number = Math.random): string {
  const hex = Array.from({ length: 16 }, () => byteHex(random)).join("");
  return `ask${hex}`;
}

function byteHex(random: () => number): string {
  return Math.floor(random() * 256)
    .toString(16)
    .padStart(2, "0");
}

export async function invokeAgent(
  credentials: AwsCredentials,
  body: AskBody,
  sessionId: string,
  post: Post = postJson,
  now: Date = new Date(),
): Promise<AgentReply> {
  const payload = JSON.stringify(body);
  const path = runtimePath(aws.runtimeArn);
  const query = "qualifier=DEFAULT";
  const host = `bedrock-agentcore.${aws.region}.amazonaws.com`;
  const response = await post(`https://${host}${path}?${query}`, {
    method: "POST",
    headers: signedHeaders(credentials, payload, path, query, host, sessionId, now),
    body: payload,
  });
  if (!response.ok) {
    throw new Error("Ask failed.");
  }
  return replyFrom(await response.text());
}

function signedHeaders(
  credentials: AwsCredentials,
  payload: string,
  path: string,
  query: string,
  host: string,
  sessionId: string,
  now: Date,
): Record<string, string> {
  return authorizedHeaders({
    method: "POST",
    path,
    query,
    service: "bedrock-agentcore",
    contentHashHeader: false,
    headers: {
      host,
      "content-type": "application/json",
      accept: "application/json",
      "x-amzn-bedrock-agentcore-runtime-session-id": sessionId,
      "x-amz-security-token": credentials.sessionToken,
    },
    payload,
    accessKeyId: credentials.accessKeyId,
    secretAccessKey: credentials.secretAccessKey,
    region: aws.region,
    now,
  });
}

function runtimePath(arn: string): string {
  // Once on the wire. The signer encodes each segment again, which SigV4 requires for this service.
  return `/runtimes/${encodeURIComponent(arn)}/invocations`;
}

async function postJson(
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
): Promise<AgentResponse> {
  return fetch(url, init);
}

function replyFrom(text: string): AgentReply {
  const payload = JSON.parse(jsonText(text)) as { answer?: unknown; entryIds?: unknown };
  if (typeof payload.answer !== "string") {
    throw new Error("Ask failed.");
  }
  return { answer: payload.answer, entryIds: stringIds(payload.entryIds) };
}

function jsonText(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    return trimmed;
  }
  return trimmed
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim())
    .filter((line) => line !== "" && line !== "[DONE]")
    .join("");
}

function stringIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) {
    return [];
  }
  return ids.filter((id) => typeof id === "string");
}
