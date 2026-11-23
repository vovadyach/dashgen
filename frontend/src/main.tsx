import "./index.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app.tsx";
import { startBotCheck } from "./bot-check.ts";
import { onceOnline, seedOnline } from "./health.ts";
import { ThemeProvider } from "./theme.tsx";

const queryClient = new QueryClient();
// The answer of index.html's health check, if it's in, for the first render.
seedOnline(queryClient);

const root = document.getElementById("root");
if (!root) throw new Error("index.html has no #root element");

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
);
// Cloudflare's check that a person asks (ADR-0021). Its script loads after the
// page, so it never holds up the first paint, and only once a check finds
// DashGen online: offline, nobody can ask, so a page first opened then loads
// nothing from Cloudflare. Started now all the same, so a question asked
// before the health check answers still waits for its token.
startBotCheck(onceOnline(queryClient));
