import { describe, it, expect, vi } from "vitest";
import { isAdmin, parseGroups } from "./auth";

vi.mock("aws-amplify/auth", () => ({ fetchAuthSession: vi.fn() }));

describe("parseGroups", () => {
  it.each([
    [["Admin", "Staff"], ["Admin", "Staff"]],
    ['["Admin","Staff"]', ["Admin", "Staff"]],
    ["[Admin Staff]", ["Admin", "Staff"]],
    ["[Admin, Staff]", ["Admin", "Staff"]],
    ["Admin", ["Admin"]],
    ["", []],
    [undefined, []],
    [42, []],
  ])("parses %j", (claim, expected) => {
    expect(parseGroups(claim)).toEqual(expected);
  });
});

describe("isAdmin", () => {
  const session = (groups: unknown) => ({
    tokens: { idToken: { payload: { "cognito:groups": groups } } },
  });

  it("accepts every claim form that carries the Admin group", () => {
    for (const claim of [["Admin"], '["Admin"]', "[Admin Other]", "[Other, Admin]", "Admin"]) {
      expect(isAdmin(session(claim) as never)).toBe(true);
    }
  });

  it("matches the group name exactly, never by substring or case", () => {
    for (const claim of [["Admins"], ["SuperAdmin"], "[NotAdmin]", "admin", ["Master Admin"]]) {
      expect(isAdmin(session(claim) as never)).toBe(false);
    }
  });

  it("is false without a token, groups claim, or with a legacy custom:role", () => {
    expect(isAdmin(null)).toBe(false);
    expect(isAdmin({ tokens: undefined } as never)).toBe(false);
    expect(isAdmin({ "custom:role": '["Admin"]' })).toBe(false);
  });

  it("accepts a raw ID token payload", () => {
    expect(isAdmin({ "cognito:groups": ["Admin"] })).toBe(true);
  });
});
