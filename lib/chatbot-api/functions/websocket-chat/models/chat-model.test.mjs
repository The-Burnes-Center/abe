import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@aws-sdk/client-bedrock-runtime", () => ({
  BedrockRuntimeClient: vi.fn(function () { return { send: vi.fn() }; }),
  InvokeModelWithResponseStreamCommand: vi.fn(function (i) { return i; }),
  InvokeModelCommand: vi.fn(function (i) { return i; }),
}));

import ClaudeModel, { defaultPrimaryModelId } from "./chat-model.mjs";

const saved = { model: process.env.PRIMARY_MODEL_ID, region: process.env.AWS_REGION };
afterEach(() => {
  for (const [key, env] of [["model", "PRIMARY_MODEL_ID"], ["region", "AWS_REGION"]]) {
    if (saved[key] === undefined) delete process.env[env];
    else process.env[env] = saved[key];
  }
});

describe("model selection", () => {
  it.each([
    ["us-east-1", "us.anthropic.claude-opus-4-6-v1"],
    ["us-west-2", "us.anthropic.claude-opus-4-6-v1"],
    ["eu-central-1", "eu.anthropic.claude-opus-4-6-v1"],
    ["ap-southeast-2", "apac.anthropic.claude-opus-4-6-v1"],
  ])("defaults to the Opus 4.6 inference profile for %s", (region, expected) => {
    expect(defaultPrimaryModelId(region)).toBe(expected);
  });

  it("fails fast with a clear error where no default profile exists", () => {
    expect(() => defaultPrimaryModelId("sa-east-1")).toThrow(/Set PRIMARY_MODEL_ID/);
    expect(() => defaultPrimaryModelId(undefined)).toThrow(/PRIMARY_MODEL_ID is not set/);
  });

  it("prefers an explicit id, then PRIMARY_MODEL_ID, then the regional default", () => {
    process.env.AWS_REGION = "eu-west-1";
    delete process.env.PRIMARY_MODEL_ID;
    expect(new ClaudeModel().modelId).toBe("eu.anthropic.claude-opus-4-6-v1");
    process.env.PRIMARY_MODEL_ID = "custom-model";
    expect(new ClaudeModel().modelId).toBe("custom-model");
    expect(new ClaudeModel("fast-model").modelId).toBe("fast-model");
  });
});
