import { createRemoteJWKSet, jwtVerify } from "jose";

export interface AuthUser {
  sub: string;
  email: string;
  name: string;
  picture: string;
}

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? "";
/** Test-only escape hatch: accept `fake:{json}` tokens. Never set in prod. */
const DEV_FAKE = process.env.AUTH_DEV_FAKE === "1";

/**
 * Whether sign-in + membership enforcement is active. Without a configured
 * Google client id the server runs open (guest mode), matching a client
 * built without auth config.
 */
export const authEnabled = CLIENT_ID !== "" || DEV_FAKE;

/** Exposed to the client via /api/config so only the server needs the env. */
export const googleClientId = CLIENT_ID;

const jwks = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs")
);

export async function verifyIdToken(idToken: string): Promise<AuthUser> {
  if (DEV_FAKE && idToken.startsWith("fake:")) {
    const u = JSON.parse(idToken.slice(5)) as { email: string; name?: string };
    const email = String(u.email).toLowerCase();
    return { sub: `fake-${email}`, email, name: u.name ?? email, picture: "" };
  }
  const { payload } = await jwtVerify(idToken, jwks, {
    issuer: ["https://accounts.google.com", "accounts.google.com"],
    audience: CLIENT_ID,
  });
  if (typeof payload.email !== "string" || payload.email_verified === false) {
    throw new Error("Google account has no verified email");
  }
  return {
    sub: String(payload.sub),
    email: payload.email.toLowerCase(),
    name: String(payload.name ?? payload.email),
    picture: String(payload.picture ?? ""),
  };
}
