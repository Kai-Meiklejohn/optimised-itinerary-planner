import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../config/api", () => ({
  API_BASE_URL: "https://api.example.com",
}));

import { createUserProfile } from "./userService";

describe("createUserProfile", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("posts the Cognito ID token to the protected users endpoint", async () => {
    localStorage.setItem("idToken", "id-token");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ userId: "cognito-user-id" }), { status: 200 }),
    );

    await expect(createUserProfile()).resolves.toEqual({ userId: "cognito-user-id" });

    expect(fetchMock).toHaveBeenCalledWith("https://api.example.com/users", {
      method: "POST",
      headers: {
        Authorization: "Bearer id-token",
        "Content-Type": "application/json",
      },
    });
  });

  it("fails clearly when no authenticated session exists", async () => {
    await expect(createUserProfile()).rejects.toThrow(
      "Your account was verified, but the authenticated session is missing.",
    );
  });
});