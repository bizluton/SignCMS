import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { registerPlayerSW } from "./lib/playerSW";

registerPlayerSW();

createRoot(document.getElementById("root")!).render(<App />);
