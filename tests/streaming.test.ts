import { describe, expect, it } from "vitest";
import { createTestSetup } from "./helpers.js";

function sse(chunks: string[], errorAfter = -1): Response {
  const enc = new TextEncoder();
  let n = 0;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      for (const ch of chunks) {
        if (n === errorAfter) {
          // Error on a later microtask so already-queued chunks are delivered.
          queueMicrotask(() => c.error(new Error("mid-stream boom")));
          return;
        }
        c.enqueue(enc.encode(`data: ${ch}\n\n`));
        n++;
      }
      if (n === errorAfter) {
        queueMicrotask(() => c.error(new Error("mid-stream boom")));
        return;
      }
      c.enqueue(enc.encode("data: [DONE]\n\n"));
      c.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

const chunk = (content: string, finish: string | null = null) =>
  JSON.stringify({
    choices: [{ index: 0, delta: { content }, finish_reason: finish }],
  });

/** Stream that delivers one chunk, then fails on the next pull (true mid-stream error). */
function sseFailingMidway(firstChunk: string): Response {
  const enc = new TextEncoder();
  let pulls = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(c) {
      if (pulls++ === 0) c.enqueue(enc.encode(`data: ${firstChunk}\n\n`));
      else c.error(new Error("mid-stream boom"));
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

function streamBody(model: string) {
  return { model, messages: [{ role: "user", content: "hi" }], stream: true };
}

describe("streaming", () => {
  it("streams SSE deltas with router headers and DONE", async () => {
    const mock: typeof fetch = async () =>
      sse([chunk("Hello"), chunk(" world", "stop")]);
    const { app } = await createTestSetup({ fetchImpl: mock });
    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: streamBody("groq::nemotron-3-super-120b"),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");
    expect(res.headers["x-router-via"]).toMatch(/^groq\//);
    expect(res.body).toContain("Hello");
    expect(res.body).toContain("world");
    expect(res.body).toContain("[DONE]");
  });

  it("falls back to the next route when the first fails before the first chunk", async () => {
    const mock: typeof fetch = async (url) => {
      if (String(url).includes("groq"))
        return new Response("overloaded", { status: 500 });
      return sse([chunk("from-openrouter", "stop")]);
    };
    const { app } = await createTestSetup({ fetchImpl: mock });
    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: {
        ...streamBody("nemotron-3-super-120b"),
        routing: { policy: "priority" },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["x-router-via"]).toMatch(/^openrouter\//);
    expect(res.body).toContain("from-openrouter");
  });

  it("never retries across providers after the stream commits", async () => {
    let openrouterHit = false;
    const mock: typeof fetch = async (url) => {
      if (String(url).includes("openrouter")) {
        openrouterHit = true;
        return sse([chunk("should-not-appear", "stop")]);
      }
      return sseFailingMidway(chunk("groq-says-hi"));
    };
    const { app, store } = await createTestSetup({ fetchImpl: mock });
    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: { ...streamBody("groq::nemotron-3-super-120b") },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("groq-says-hi");
    expect(res.body).not.toContain("should-not-appear");
    expect(openrouterHit).toBe(false);
    // Stream failure is still logged against the committed route.
    const logs = store.listRequestLogs(5);
    expect(logs.some((l) => l.status === "error")).toBe(true);
  });

  it("logs successful streams with token accounting", async () => {
    const mock: typeof fetch = async () =>
      sse([
        JSON.stringify({
          choices: [
            { index: 0, delta: { content: "hi" }, finish_reason: "stop" },
          ],
          usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
        }),
      ]);
    const { app, store } = await createTestSetup({ fetchImpl: mock });
    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: streamBody("nemotron-3-super-120b"),
    });
    expect(res.statusCode).toBe(200);
    const ok = store.listRequestLogs(5).find((l) => l.status === "success");
    expect(ok?.totalTokens).toBe(6);
  });
});
