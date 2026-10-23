import { describe, expect, it } from "vitest";
import { secretEquals } from "../src/services/secrets";

describe("secretEquals", () => {
  it("accepts identical secrets", () => {
    expect(secretEquals("abc123", "abc123")).toBe(true);
  });

  it("rejects different secrets of the same length", () => {
    expect(secretEquals("abc123", "abc124")).toBe(false);
  });

  it("rejects different lengths without throwing", () => {
    expect(secretEquals("abc", "abc123")).toBe(false);
  });

  it("rejects empty, null and undefined on either side", () => {
    expect(secretEquals("", "")).toBe(false);
    expect(secretEquals(null, "x")).toBe(false);
    expect(secretEquals("x", undefined)).toBe(false);
  });
});
