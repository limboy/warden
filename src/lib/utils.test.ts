import { describe, expect, it } from "vitest";
import { basename, dirname } from "./utils";

describe("basename", () => {
  it.each([
    ["/Users/me/notes/vault.warden", "vault.warden"],
    ["C:\\Users\\me\\vault.warden", "vault.warden"],
    ["vault.warden", "vault.warden"],
  ])("%s -> %s", (input, expected) => {
    expect(basename(input)).toBe(expected);
  });
});

describe("dirname", () => {
  it.each([
    ["/Users/me/notes/vault.warden", "/Users/me/notes"],
    ["C:\\Users\\me\\vault.warden", "C:\\Users\\me"],
  ])("%s -> %s", (input, expected) => {
    expect(dirname(input)).toBe(expected);
  });
});
