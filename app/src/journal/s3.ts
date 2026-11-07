import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

import { aws } from "@/aws";
import type { ObjectStore } from "@/journal/object-store";

export type AwsCredentials = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
};

type SignedRequest = {
  method: string;
  path: string;
  headers: Record<string, string>;
  payload: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  now: Date;
  query?: string;
  service?: string;
  contentHashHeader?: boolean;
};

export function s3ObjectStore(credentials: AwsCredentials): ObjectStore {
  return {
    put(key, text) {
      return sendObject("PUT", key, text, credentials);
    },
    remove(key) {
      return sendObject("DELETE", key, "", credentials);
    },
    list(prefix) {
      return listObjects(prefix, credentials);
    },
    get(key) {
      return readObject(key, credentials);
    },
  };
}

export function authorizationHeader(request: SignedRequest): string {
  const signed = signedRequest(request);
  const scope = credentialScope(signed.date, request.region, request.service ?? "s3");
  return (
    `AWS4-HMAC-SHA256 Credential=${request.accessKeyId}/${scope}, ` +
    `SignedHeaders=${signed.names}, Signature=${signed.signature}`
  );
}

export function authorizedHeaders(request: SignedRequest): Record<string, string> {
  const headers = signedHeaderValues(
    request.headers,
    request.payload,
    request.now,
    request.contentHashHeader !== false,
  );
  return {
    ...headers,
    Authorization: authorizationHeader(request),
  };
}

async function sendObject(
  method: "PUT" | "DELETE",
  key: string,
  text: string,
  credentials: AwsCredentials,
): Promise<void> {
  const extra: Record<string, string> = {};
  if (text !== "") {
    extra["content-type"] = contentType(key);
  }
  const response = await signedFetch(method, `/${key}`, "", text, extra, credentials);
  if (!response.ok) {
    throw new Error(`Upload failed (${response.status}).`);
  }
}

async function readObject(key: string, credentials: AwsCredentials): Promise<string | null> {
  const response = await signedFetch("GET", `/${key}`, "", "", {}, credentials);
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Download failed (${response.status}).`);
  }
  return response.text();
}

async function listObjects(prefix: string, credentials: AwsCredentials): Promise<string[]> {
  const keys: string[] = [];
  let token = "";
  do {
    const page = await listPage(prefix, token, credentials);
    keys.push(...page.keys);
    token = page.next;
  } while (token !== "");
  return keys;
}

async function listPage(
  prefix: string,
  token: string,
  credentials: AwsCredentials,
): Promise<{ keys: string[]; next: string }> {
  const response = await signedFetch("GET", "/", listQuery(prefix, token), "", {}, credentials);
  if (!response.ok) {
    throw new Error(`Download failed (${response.status}).`);
  }
  const xml = await response.text();
  return { keys: listedKeys(xml), next: nextPage(xml) };
}

async function signedFetch(
  method: string,
  path: string,
  query: string,
  text: string,
  extra: Record<string, string>,
  credentials: AwsCredentials,
): Promise<Response> {
  const now = new Date();
  const headers: Record<string, string> = {
    host: `${aws.bucket}.s3.${aws.region}.amazonaws.com`,
    "x-amz-security-token": credentials.sessionToken,
    ...extra,
  };
  const authorization = authorizationHeader({
    method,
    path,
    query,
    headers,
    payload: text,
    accessKeyId: credentials.accessKeyId,
    secretAccessKey: credentials.secretAccessKey,
    region: aws.region,
    now,
  });
  const url = `https://${headers.host}${canonicalUri(path)}${query === "" ? "" : `?${query}`}`;
  return fetch(url, {
    method,
    headers: {
      ...signedHeaderValues(headers, text, now),
      Authorization: authorization,
    },
    body: text === "" ? undefined : text,
  });
}

function listQuery(prefix: string, token: string): string {
  const params: [string, string][] = [
    ["list-type", "2"],
    ["prefix", prefix],
  ];
  if (token !== "") {
    params.push(["continuation-token", token]);
  }
  return params
    .map(([name, value]) => [encodeURIComponent(name), encodeURIComponent(value)] as [string, string])
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `${name}=${value}`)
    .join("&");
}

function listedKeys(xml: string): string[] {
  return [...xml.matchAll(/<Key>([^<]*)<\/Key>/g)].map((match) => decodeXml(match[1]));
}

function nextPage(xml: string): string {
  if (!xml.includes("<IsTruncated>true</IsTruncated>")) {
    return "";
  }
  const token = xml.match(/<NextContinuationToken>([^<]*)<\/NextContinuationToken>/);
  return token === null ? "" : decodeXml(token[1]);
}

function decodeXml(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'");
}

function signedRequest(request: SignedRequest) {
  const service = request.service ?? "s3";
  const stamp = amzTimestamp(request.now);
  const date = stamp.slice(0, 8);
  const payloadHash = sha256Hex(request.payload);
  const headers: Record<string, string> = {
    ...lowerHeaders(request.headers),
    "x-amz-date": stamp,
  };
  if (request.contentHashHeader !== false) {
    headers["x-amz-content-sha256"] = payloadHash;
  }
  const names = Object.keys(headers).sort();
  const path = canonicalUri(request.path);
  const canonical = canonicalRequest(request.method, path, request.query ?? "", headers, names, payloadHash);
  const scope = credentialScope(date, request.region, service);
  const toSign = `AWS4-HMAC-SHA256\n${stamp}\n${scope}\n${sha256Hex(canonical)}`;
  const key = signingKey(request.secretAccessKey, date, request.region, service);
  const signature = bytesToHex(hmac(sha256, key, utf8ToBytes(toSign)));
  return { date, names: names.join(";"), signature };
}

function signedHeaderValues(
  headers: Record<string, string>,
  payload: string,
  now: Date,
  contentHashHeader = true,
): Record<string, string> {
  const signed: Record<string, string> = {
    ...headers,
    "x-amz-date": amzTimestamp(now),
  };
  if (contentHashHeader) {
    signed["x-amz-content-sha256"] = sha256Hex(payload);
  }
  return signed;
}

function canonicalRequest(
  method: string,
  path: string,
  query: string,
  headers: Record<string, string>,
  names: string[],
  payloadHash: string,
): string {
  const lines = names.map((name) => `${name}:${headers[name].trim()}\n`).join("");
  return `${method}\n${path}\n${query}\n${lines}\n${names.join(";")}\n${payloadHash}`;
}

function canonicalUri(path: string): string {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function credentialScope(date: string, region: string, service: string): string {
  return `${date}/${region}/${service}/aws4_request`;
}

function signingKey(secret: string, date: string, region: string, service: string): Uint8Array {
  const dateKey = hmac(sha256, utf8ToBytes(`AWS4${secret}`), utf8ToBytes(date));
  const regionKey = hmac(sha256, dateKey, utf8ToBytes(region));
  const serviceKey = hmac(sha256, regionKey, utf8ToBytes(service));
  return hmac(sha256, serviceKey, utf8ToBytes("aws4_request"));
}

function lowerHeaders(headers: Record<string, string>): Record<string, string> {
  const lowered: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    lowered[name.toLowerCase()] = value;
  }
  return lowered;
}

function amzTimestamp(now: Date): string {
  return now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function sha256Hex(value: string): string {
  return bytesToHex(sha256(utf8ToBytes(value)));
}

function contentType(key: string): string {
  if (key.endsWith(".json")) {
    return "application/json";
  }
  return "text/markdown; charset=utf-8";
}
