import { describe, expect, it } from "vitest";
import { basename } from "./utils";

describe("basename", () => {
  it.each([
    ["/Users/me/notes/vault.warden", "vault.warden"],
    ["C:\\Users\\me\\vault.warden", "vault.warden"],
    ["vault.warden", "vault.warden"],
  ])("%s -> %s", (input, expected) => {
    expect(basename(input)).toBe(expected);
  });
});
