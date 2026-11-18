import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PortCendre } from "@/components/PortCendre";
import "@/styles.css";

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <PortCendre />
    </StrictMode>,
  );
}
