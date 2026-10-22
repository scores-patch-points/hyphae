#!/usr/bin/env node
// node platform/main.mjs   (see platform/README.md for the environment)
import { loadKey } from "./crypto.mjs";
import { createGoogle } from "./google.mjs";
import { createAI } from "./ai.mjs";
import { openStore } from "./store.mjs";
import { createEngine } from "./engine.mjs";
import { createApp } from "./server.mjs";

const need = (k) => { if (!process.env[k]) { console.error(`missing ${k}`); process.exit(1); } return process.env[k]; };
const key = loadKey(need("PLATFORM_KEY"));
const base = (process.env.PLATFORM_BASE_URL || "http://localhost:8787").replace(/\/$/, "");
const store = openStore(process.env.PLATFORM_DB || "platform.db");
const google = createGoogle({ clientId: need("GOOGLE_CLIENT_ID"), clientSecret: need("GOOGLE_CLIENT_SECRET"), redirectUri: base + "/auth/callback" });
const ai = createAI({ apiKey: need("ANTHROPIC_API_KEY") });
const engine = createEngine({ store, google, ai, key });
const port = Number(process.env.PORT || 8787);
createApp({ store, google, engine, key }).listen(port, () => console.log(`hyphae platform on ${base}`));
setInterval(() => engine.tick().catch((e) => console.error("tick", e.message)), 60000);
