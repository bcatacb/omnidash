import { describe, it, expect } from "vitest";
import { isPowerState, POWER_ACTIONS } from "./index";

describe("shared contract", () => {
  it("recognizes valid power states incl. expired", () => {
    expect(isPowerState("on")).toBe(true);
    expect(isPowerState("expired")).toBe(true);
    expect(isPowerState("nope")).toBe(false);
  });
  it("exposes the three power actions", () => {
    expect(POWER_ACTIONS).toEqual(["on", "off", "restart"]);
  });
});
