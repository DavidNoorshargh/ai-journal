import { aws } from "@/aws";
import { askBody, invokeAgent } from "@/journal/ask";
import type { Entry } from "@/journal/entries";

describe("ask body", () => {
  it("attaches pending and failed notes, including the title", () => {
    const body = askBody("  Where was the lantern?  ", [
      note("pending", "Blue lantern"),
      note("failed", ""),
      note("uploaded", "Already in the cloud"),
    ]);

    expect(body.question).toBe("Where was the lantern?");
    expect(body.unsyncedEntries).toEqual([
      { id: "pending", date: "20261024", title: "Blue lantern", body: "On the table.", tags: ["thoughts"] },
      { id: "failed", date: "20261024", title: "", body: "On the table.", tags: ["thoughts"] },
    ]);
  });
});

describe("invoke agent", () => {
  it("signs the call for the runtime and reads the answer", async () => {
    const calls: { url: string; headers: Record<string, string>; body: string }[] = [];
    const reply = await invokeAgent(
      { accessKeyId: "AKID", secretAccessKey: "secret", sessionToken: "token" },
      askBody("lantern", [note("pending", "Blue lantern")]),
      "askaabbccddeeff00112233445566778899",
      async (url, init) => {
        calls.push({ url, headers: init.headers, body: init.body });
        return { ok: true, text: async () => JSON.stringify({ answer: "A lantern.", entryIds: ["pending"] }) };
      },
      new Date("2013-05-24T00:00:00Z"),
    );

    expect(reply).toEqual({ answer: "A lantern.", entryIds: ["pending"] });
    expect(calls[0].url).toBe(
      `https://bedrock-agentcore.eu-west-2.amazonaws.com/runtimes/${encodeURIComponent(aws.runtimeArn)}/invocations?qualifier=DEFAULT`,
    );
    expect(calls[0].headers.Authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=AKID/20130524/eu-west-2/bedrock-agentcore/aws4_request, " +
        "SignedHeaders=accept;content-type;host;x-amz-date;x-amz-security-token;x-amzn-bedrock-agentcore-runtime-session-id, " +
        "Signature=99e052601b6073f274da7c336dd9324013a0d42cbbd9bad90193ddfdc2fc5e87",
    );
    expect(calls[0].headers["x-amzn-bedrock-agentcore-runtime-session-id"]).toBe("askaabbccddeeff00112233445566778899");
    expect(JSON.parse(calls[0].body).unsyncedEntries[0].title).toBe("Blue lantern");
  });

  it("reads an answer delivered as an event stream", async () => {
    const reply = await invokeAgent(
      { accessKeyId: "AKID", secretAccessKey: "secret", sessionToken: "token" },
      askBody("lantern", []),
      "askaabbccddeeff00112233445566778899",
      async () => ({
        ok: true,
        text: async () => 'data: {"answer":"A lantern.","entryIds":[]}\n\n',
      }),
    );

    expect(reply.answer).toBe("A lantern.");
  });
});

function note(syncState: Entry["syncState"], title: string): Entry {
  return {
    id: syncState,
    date: "20261024",
    title,
    body: "On the table.",
    tags: ["thoughts"],
    syncState,
    createdAt: "2026-10-24T00:00:00.000Z",
    updatedAt: "2026-10-24T00:00:00.000Z",
  };
}
