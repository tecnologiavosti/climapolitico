import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { ErrorBoundary } from "./components/ErrorBoundary";

// Força que todo acesso ocorra no domínio oficial climapolitico.com.br.
// Mantém localhost/127.0.0.1 livre para desenvolvimento.
const host = window.location.hostname;
const isLocal = host === "localhost" || host === "127.0.0.1" || host.endsWith(".local");
const isOfficial = host === "climapolitico.com.br" || host === "www.climapolitico.com.br";
if (!isLocal && !isOfficial) {
  const target = `https://climapolitico.com.br${window.location.pathname}${window.location.search}${window.location.hash}`;
  window.location.replace(target);
}


createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);

