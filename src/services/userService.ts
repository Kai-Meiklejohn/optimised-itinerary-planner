import { API_BASE_URL } from "../config/api";
import { getSessionVersion, refreshSession } from "./authService";

const postProfile = (idToken: string) =>
  fetch(`${API_BASE_URL}/users`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${idToken}`,
      "Content-Type": "application/json",
    },
  });

export const createUserProfile = async () => {
  const idToken = localStorage.getItem("idToken");

  if (!idToken) {
    throw new Error("Your account was verified, but the authenticated session is missing.");
  }

  const version = getSessionVersion();
  let response = await postProfile(idToken);

  // Mirrors backendApi's requestJson: a 401 here usually just means the ID
  // token expired, not that the account lacks permission - refresh once and
  // retry before giving up, instead of failing profile creation outright.
  if (response.status === 401) {
    try {
      const tokens = await refreshSession();
      if (getSessionVersion() !== version) {
        throw new Error("Session changed");
      }
      response = await postProfile(tokens.idToken);
    } catch {
      throw new Error("Your account was verified, but your user profile could not be created.");
    }
  }

  if (!response.ok) {
    throw new Error("Your account was verified, but your user profile could not be created.");
  }

  return response.json();
};