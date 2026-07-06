// Google Identity Services (GIS) integration. The server tells us via
// /api/config whether sign-in is required and with which OAuth client id;
// the ID token (a short-lived JWT) is kept in localStorage and presented
// on the spaces listing and on every room join.

export interface AuthInfo {
  idToken: string;
  email: string;
  name: string;
  picture: string;
  /** Token expiry, ms since epoch (~1h from issue). */
  exp: number;
}

const KEY = "gather:auth";

export function getStoredAuth(): AuthInfo | null {
  try {
    const a = JSON.parse(localStorage.getItem(KEY) ?? "") as AuthInfo;
    if (!a?.idToken || a.exp - 60_000 < Date.now()) return null;
    return a;
  } catch {
    return null;
  }
}

export function storeAuth(a: AuthInfo | null): void {
  if (a) localStorage.setItem(KEY, JSON.stringify(a));
  else localStorage.removeItem(KEY);
}

export function decodeCredential(idToken: string): AuthInfo {
  const b64 = idToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
  const payload = JSON.parse(atob(b64)) as {
    email: string;
    name?: string;
    picture?: string;
    exp: number;
  };
  return {
    idToken,
    email: payload.email,
    name: payload.name ?? payload.email,
    picture: payload.picture ?? "",
    exp: payload.exp * 1000,
  };
}

type Gsi = {
  accounts: {
    id: {
      initialize(cfg: object): void;
      renderButton(el: HTMLElement, cfg: object): void;
      prompt(): void;
      disableAutoSelect(): void;
    };
  };
};

let gsiLoading: Promise<Gsi> | null = null;

function loadGsi(): Promise<Gsi> {
  gsiLoading ??= new Promise((resolve, reject) => {
    const existing = (window as { google?: Gsi }).google;
    if (existing?.accounts?.id) return resolve(existing);
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = () => resolve((window as unknown as { google: Gsi }).google);
    s.onerror = () => reject(new Error("failed to load Google sign-in"));
    document.head.appendChild(s);
  });
  return gsiLoading;
}

export async function renderGoogleButton(
  clientId: string,
  el: HTMLElement,
  onAuth: (a: AuthInfo) => void
): Promise<void> {
  const gsi = await loadGsi();
  gsi.accounts.id.initialize({
    client_id: clientId,
    auto_select: true,
    callback: (resp: { credential: string }) => {
      const a = decodeCredential(resp.credential);
      storeAuth(a);
      onAuth(a);
    },
  });
  gsi.accounts.id.renderButton(el, { theme: "filled_blue", size: "large" });
  // One Tap: silently re-issues a credential for returning users, which is
  // what keeps ?rejoin=1 seamless after the ID token expires.
  gsi.accounts.id.prompt();
}

export function signOut(): void {
  storeAuth(null);
  (window as { google?: Gsi }).google?.accounts.id.disableAutoSelect();
}
