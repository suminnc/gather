import { EMOTES } from "@gather/shared";
import { sendEmote } from "../net/connection";

/** Reaction buttons; keys 1-6 fire the same emotes from the scene. */
export function EmoteBar() {
  return (
    <div className="emote-bar">
      {EMOTES.map((emoji, i) => (
        <button key={emoji} title={`React (${i + 1})`} onClick={() => sendEmote(i)}>
          {emoji}
        </button>
      ))}
    </div>
  );
}
