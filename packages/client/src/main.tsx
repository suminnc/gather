import { createRoot } from "react-dom/client";
import { DEFAULT_SPACE_ID } from "@gather/shared";
import App from "./App";
import { useStore } from "./store";
import "./styles.css";

if (import.meta.env.DEV) {
  (window as any).__gather = useStore;
}

const match = location.pathname.match(/^\/space\/([a-zA-Z0-9_-]+)/);
const spaceId = match ? match[1] : DEFAULT_SPACE_ID;
if (!match) history.replaceState(null, "", `/space/${spaceId}`);

createRoot(document.getElementById("root")!).render(
  <App spaceId={spaceId} invited={match !== null} />
);
