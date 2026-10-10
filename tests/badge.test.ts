import { describe, expect, it } from "vitest";
import { formatCount, renderBadge } from "../src/badge";

describe("renderBadge", () => {
  it("renders SVG markup with an accessible label", () => {
    const svg = renderBadge("downloads", "1.2k", "green");
    expect(svg).toContain("<svg");
    expect(svg).toContain('aria-label="downloads: 1.2k"');
    expect(svg).toContain("#4c1");
  });

  it("escapes XML values", () => {
    expect(renderBadge("<tag>", "a&b")).toContain("&lt;tag&gt;");
    expect(renderBadge("x", "a&b")).toContain("a&amp;b");
  });

  it("formats compact counts", () => {
    expect(formatCount(1200)).toBe("1.2K");
  });
});