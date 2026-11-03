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
};

export function s3ObjectStore(credentials: AwsCredentials): ObjectStore {
  return {
    put(key, text) {
      return sendObject("PUT", key, text, credentials);
    },
    remove(key) {
      return sendObject("DELETE", key, "", credentials);
    },
  };
}

export function authorizationHeader(request: SignedRequest): string {
  const signed = signedRequest(request);
  const scope = credentialScope(signed.date, request.region);
  return (
    `AWS4-HMAC-SHA256 Credential=${request.accessKeyId}/${scope}, ` +
    `SignedHeaders=${signed.names}, Signature=${signed.signature}`
  );
}

async function sendObject(
  method: "PUT" | "DELETE",
  key: string,
  text: string,
  credentials: AwsCredentials,
): Promise<void> {
  const now = new Date();
  const path = `/${key}`;
  const headers: Record<string, string> = {
    host: `${aws.bucket}.s3.${aws.region}.amazonaws.com`,
    "x-amz-security-token": credentials.sessionToken,
  };
  if (text !== "") {
    headers["content-type"] = contentType(key);
  }
  const authorization = authorizationHeader({
    method,
    path,
    headers,
    payload: text,
    accessKeyId: credentials.accessKeyId,
    secretAccessKey: credentials.secretAccessKey,
    region: aws.region,
    now,
  });
  const response = await fetch(`https://${headers.host}${canonicalUri(path)}`, {
    method,
    headers: {
      ...signedHeaderValues(headers, text, now),
      Authorization: authorization,
    },
    body: text === "" ? undefined : text,
  });
  if (!response.ok) {
    throw new Error(`Upload failed (${response.status}).`);
  }
}

function signedRequest(request: SignedRequest) {
  const stamp = amzTimestamp(request.now);
  const date = stamp.slice(0, 8);
  const payloadHash = sha256Hex(request.payload);
  const headers = {
    ...lowerHeaders(request.headers),
    "x-amz-date": stamp,
    "x-amz-content-sha256": payloadHash,
  };
  const names = Object.keys(headers).sort();
  const canonical = canonicalRequest(request.method, request.path, headers, names, payloadHash);
  const scope = credentialScope(date, request.region);
  const toSign = `AWS4-HMAC-SHA256\n${stamp}\n${scope}\n${sha256Hex(canonical)}`;
  const signature = bytesToHex(hmac(sha256, signingKey(request.secretAccessKey, date, request.region), utf8ToBytes(toSign)));
  return { date, names: names.join(";"), signature };
}

function signedHeaderValues(headers: Record<string, string>, payload: string, now: Date): Record<string, string> {
  return {
    ...headers,
    "x-amz-date": amzTimestamp(now),
    "x-amz-content-sha256": sha256Hex(payload),
  };
}

function canonicalRequest(
  method: string,
  path: string,
  headers: Record<string, string>,
  names: string[],
  payloadHash: string,
): string {
  const lines = names.map((name) => `${name}:${headers[name].trim()}\n`).join("");
  return `${method}\n${canonicalUri(path)}\n\n${lines}\n${names.join(";")}\n${payloadHash}`;
}

function canonicalUri(path: string): string {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function credentialScope(date: string, region: string): string {
  return `${date}/${region}/s3/aws4_request`;
}

function signingKey(secret: string, date: string, region: string): Uint8Array {
  const dateKey = hmac(sha256, utf8ToBytes(`AWS4${secret}`), utf8ToBytes(date));
  const regionKey = hmac(sha256, dateKey, utf8ToBytes(region));
  const serviceKey = hmac(sha256, regionKey, utf8ToBytes("s3"));
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
