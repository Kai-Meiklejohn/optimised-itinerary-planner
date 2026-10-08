const apiUrl = import.meta.env.VITE_API_BASE_URL?.trim();

if (!apiUrl) {
  throw new Error(
    "Missing VITE_API_BASE_URL. Set it in .env.local for development or in the production build environment.",
  );
}

export const API_BASE_URL = apiUrl.replace(/\/$/, "");