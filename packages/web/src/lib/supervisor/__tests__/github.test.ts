import { describe, expect, it } from "vitest";
import { parseIssueInput, parseReviewInput } from "../github";

describe("supervisor github input parsing", () => {
  it("adds agent:backlog only when issue is explicitly sent to AO", () => {
    expect(
      parseIssueInput({
        projectId: "app",
        title: "Track follow-up",
        sendToAo: true,
      }).labels,
    ).toEqual(["agent:backlog"]);
  });

  it("rejects implicit backlog labels", () => {
    expect(() =>
      parseIssueInput({
        projectId: "app",
        title: "Track follow-up",
        labels: ["agent:backlog"],
      }),
    ).toThrow("agent:backlog requires sendToAo=true");
  });

  it("requires explicit request id for PR reviews", () => {
    expect(() =>
      parseReviewInput({
        action: "approve",
        reviewPacketHeadSha: "abc123",
      }),
    ).toThrow("requestId is required");
  });
});
