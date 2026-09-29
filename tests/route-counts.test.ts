import { describe, expect, it } from "vitest";
import { createTestSetup } from "./helpers.js";

describe("route counts", () => {
  it("returns per-resource counts in one request", async () => {
    const { app } = await createTestSetup();
    const res = await app.inject({
      method: "GET", url: "/api/routes/counts?capability=llm.chat",
    });
    expect(res.statusCode).toBe(200);
    // 2 provider mappings × 1 cred each = 2 routes.
    expect(res.json().data["llm:model:nemotron-3-super-120b"]).toBe(2);
  });
});
