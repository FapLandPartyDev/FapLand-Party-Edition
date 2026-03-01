import { createRoot } from "react-dom/client";
import "./styles.css";
import { StartupGate } from "./StartupGate";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element not found");
}

createRoot(rootElement).render(<StartupGate />);
