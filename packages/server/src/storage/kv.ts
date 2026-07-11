/**
 * Durable key-value storage over Upstash Redis's HTTPS REST API. Enabled
 * when UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN are set (Render
 * env); everything falls back to the local data/ directory otherwise, so
 * dev needs no external service. Values are JSON strings; a full map with
 * maxed-out custom tiles (~700 KB) stays inside Upstash's 1 MB request cap.
 */

const URL = process.env.UPSTASH_REDIS_REST_URL?.replace(/\/+$/, "");
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

export const kvEnabled = Boolean(URL && TOKEN);

async function command(parts: string[]): Promise<unknown> {
  const res = await fetch(URL!, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(parts),
  });
  if (!res.ok) {
    throw new Error(`kv ${parts[0]} failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { result?: unknown; error?: string };
  if (body.error) throw new Error(`kv ${parts[0]}: ${body.error}`);
  return body.result;
}

export async function kvGet(key: string): Promise<string | null> {
  return (await command(["GET", key])) as string | null;
}

export async function kvSet(key: string, value: string): Promise<void> {
  await command(["SET", key, value]);
}
