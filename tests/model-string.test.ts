import { describe, expect, it } from "vitest";
import { parseModelString, toCanonicalId } from "../src/shared/model-string.js";

describe("model string parsing", () => {
  it("parses canonical model for auto-routing", () => {
    const p = parseModelString("nemotron-3-super-120b");
    expect(p.providerPin).toBeNull();
    expect(p.logicalModel).toBe("nemotron-3-super-120b");
    expect(p.canonicalResourceId).toBe("llm:model:nemotron-3-super-120b");
  });

  it("parses provider pin with :: separator", () => {
    const p = parseModelString("groq::nemotron-3-super-120b");
    expect(p.providerPin).toBe("groq");
    expect(p.logicalModel).toBe("nemotron-3-super-120b");
    expect(p.canonicalResourceId).toBe("llm:model:nemotron-3-super-120b");
  });

  it("keeps slashes in the logical model (upstream-style ids)", () => {
    const p = parseModelString("openrouter::nvidia/nemotron-3-super-120b");
    expect(p.providerPin).toBe("openrouter");
    expect(p.logicalModel).toBe("nvidia/nemotron-3-super-120b");
    expect(p.canonicalResourceId).toBe("llm:model:nvidia/nemotron-3-super-120b");
  });

  it("rejects invalid pins and empty models", () => {
    expect(() => parseModelString("")).toThrow();
    expect(() => parseModelString("bad pin::model")).toThrow();
    expect(() => parseModelString("groq::")).toThrow();
  });

  it("canonicalizes case", () => {
    expect(toCanonicalId("Nemotron-3-Super-120B")).toBe("llm:model:nemotron-3-super-120b");
  });
});
