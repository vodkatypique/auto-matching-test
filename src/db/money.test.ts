import { describe, expect, it } from "vitest";
import { numericToCents } from "./money";

describe("numericToCents", () => {
  it("converts numeric strings to integer cents", () => {
    expect(numericToCents("615.40")).toBe(61540);
    expect(numericToCents("-1640.27")).toBe(-164027);
    expect(numericToCents("0.01")).toBe(1);
    expect(numericToCents("9999999999.99")).toBe(999999999999);
  });

  it("adds amounts exactly, unlike floats", () => {
    expect(512.83 + 102.57).not.toBe(615.4);
    expect(numericToCents("512.83") + numericToCents("102.57")).toBe(
      numericToCents("615.40"),
    );
  });
});
