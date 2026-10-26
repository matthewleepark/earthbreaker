import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

// No <StrictMode>: its double-mount in development would build the Cesium
// viewer twice and fire every terrain and imagery request twice.
createRoot(document.getElementById("root")!).render(<App />);
