import { describe, expect, it } from "vitest";
import { createTestSetup } from "./helpers.js";

describe("protocol shims", () => {
  it("POST /v1/responses translates over chat routing", async () => {
    const { app } = await createTestSetup();
    const res = await app.inject({
      method: "POST",
      url: "/v1/responses",
      payload: { model: "groq::nemotron-3-super-120b", input: "say hi" },
    });
    expect(res.statusCode).toBe(200);
    const j = res.json();
    expect(j.object).toBe("response");
    expect(j.status).toBe("completed");
    expect(j.output[0].content[0].type).toBe("output_text");
    expect(j.output[0].content[0].text).toBe("hello");
    expect(j.usage.total_tokens).toBe(12);
    expect(res.headers["x-router-via"]).toMatch(/^groq\//);
  });

  it("POST /v1/responses accepts message-array input and pins", async () => {
    const { app } = await createTestSetup();
    const res = await app.inject({
      method: "POST",
      url: "/v1/responses",
      payload: {
        model: "nemotron-3-super-120b",
        input: [
          { role: "user", content: [{ type: "input_text", text: "hi" }] },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().output[0].content[0].text).toBe("hello");
  });

  it("POST /v1/messages speaks Anthropic's shape", async () => {
    const { app } = await createTestSetup();
    const res = await app.inject({
      method: "POST",
      url: "/v1/messages",
      payload: {
        model: "openrouter::nemotron-3-super-120b",
        max_tokens: 64,
        system: "be brief",
        messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      },
    });
    expect(res.statusCode).toBe(200);
    const j = res.json();
    expect(j.type).toBe("message");
    expect(j.content[0]).toEqual({ type: "text", text: "hello" });
    expect(j.stop_reason).toBe("end_turn");
    expect(j.usage).toEqual({ input_tokens: 5, output_tokens: 7 });
    expect(res.headers["x-router-via"]).toMatch(/^openrouter\//);
  });

  it("messages maps length finish to max_tokens stop reason", async () => {
    const { chatJson } = await import("./helpers.js");
    const finishLength: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          ...chatJson(),
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "x" },
              finish_reason: "length",
            },
          ],
        }),
        { status: 200 },
      );
    const { app } = await createTestSetup({ fetchImpl: finishLength });
    const res = await app.inject({
      method: "POST",
      url: "/v1/messages",
      payload: {
        model: "nemotron-3-super-120b",
        max_tokens: 1,
        messages: [{ role: "user", content: "hi" }],
      },
    });
    expect(res.json().stop_reason).toBe("max_tokens");
  });

  it("unknown models return protocol-native errors", async () => {
    const { app } = await createTestSetup();
    const r = await app.inject({
      method: "POST",
      url: "/v1/responses",
      payload: { model: "nope", input: "hi" },
    });
    expect(r.statusCode).toBe(404);
    expect(r.json().error).toBeDefined();
    const m = await app.inject({
      method: "POST",
      url: "/v1/messages",
      payload: {
        model: "nope",
        max_tokens: 5,
        messages: [{ role: "user", content: "hi" }],
      },
    });
    expect(m.statusCode).toBe(404);
    expect(m.json().type).toBe("error");
  });

  it("streams responses deltas and messages events", async () => {
    const enc = new TextEncoder();
    const sseBody = (text: string) =>
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(
              enc.encode(
                `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: text }, finish_reason: "stop" }] })}\n\n`,
              ),
            );
            c.enqueue(enc.encode("data: [DONE]\n\n"));
            c.close();
          },
        }),
        { status: 200, headers: { "Content-Type": "text/event-stream" } },
      );
    const { app } = await createTestSetup({
      fetchImpl: async () => sseBody("streamed-hi"),
    });
    const r = await app.inject({
      method: "POST",
      url: "/v1/responses",
      payload: { model: "nemotron-3-super-120b", input: "hi", stream: true },
    });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain("response.output_text.delta");
    expect(r.body).toContain("streamed-hi");
    expect(r.body).toContain("response.completed");
    const m = await app.inject({
      method: "POST",
      url: "/v1/messages",
      payload: {
        model: "nemotron-3-super-120b",
        max_tokens: 64,
        messages: [{ role: "user", content: "hi" }],
        stream: true,
      },
    });
    expect(m.statusCode).toBe(200);
    expect(m.body).toContain("content_block_delta");
    expect(m.body).toContain("message_stop");
  });
});
