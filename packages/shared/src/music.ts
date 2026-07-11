/**
 * Music sources a speaker object can play. YouTube playback can be
 * synchronized (embed supports autoplay + start offsets); Spotify and
 * Apple Music only offer embed widgets, so those play per-listener.
 */
export type MusicProvider = "youtube" | "spotify" | "apple";

export interface MusicSource {
  provider: MusicProvider;
  /** Canonical string stored in state (video id or embed path). */
  key: string;
}

const YT_ID = /^[a-zA-Z0-9_-]{5,15}$/;

/**
 * Parses a pasted link (or bare YouTube id) into a validated source.
 * Used by the client before sending and by the server as the gatekeeper,
 * so state never carries an arbitrary URL.
 */
export function parseMusicSource(input: string): MusicSource | null {
  const s = String(input ?? "").trim();
  if (!s || s.length > 400) return null;
  if (YT_ID.test(s)) return { provider: "youtube", key: s };

  const yt =
    s.match(/[?&]v=([a-zA-Z0-9_-]{5,15})/) ??
    s.match(/youtu\.be\/([a-zA-Z0-9_-]{5,15})/) ??
    s.match(/\/(?:shorts|embed|live)\/([a-zA-Z0-9_-]{5,15})/);
  if (yt && /youtu\.?be/.test(s)) return { provider: "youtube", key: yt[1] };

  const spotify = s.match(
    /open\.spotify\.com\/(?:intl-[a-z]{2}\/)?(track|album|playlist|episode)\/([a-zA-Z0-9]{10,30})/
  );
  if (spotify) return { provider: "spotify", key: `${spotify[1]}/${spotify[2]}` };

  const apple = s.match(
    /music\.apple\.com\/([a-z]{2}\/(?:album|playlist|song)\/[^\s?#]+(?:\?i=\d+)?)/
  );
  if (apple) return { provider: "apple", key: apple[1] };

  return null;
}

/** Embed player URL for a parsed source. */
export function musicEmbedUrl(src: MusicSource): string {
  switch (src.provider) {
    case "youtube":
      return `https://www.youtube.com/embed/${src.key}`;
    case "spotify":
      return `https://open.spotify.com/embed/${src.key}`;
    case "apple":
      return `https://embed.music.apple.com/${src.key}`;
  }
}
