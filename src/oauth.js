import "dotenv/config";
import crypto from "crypto";
import { saveShopToken } from "./db.js";

const API_KEY = process.env.SHOPIFY_API_KEY;
const API_SECRET = process.env.SHOPIFY_API_SECRET;
const SCOPES =
  process.env.SHOPIFY_SCOPES ||
  "read_orders,write_orders,read_fulfillments,write_fulfillments,read_customers";
const APP_URL = process.env.SHOPIFY_APP_URL;

function assertConfigured() {
  if (!API_KEY || !API_SECRET || !APP_URL) {
    throw new Error(
      "SHOPIFY_API_KEY, SHOPIFY_API_SECRET et SHOPIFY_APP_URL doivent être définis dans .env pour l'authentification OAuth."
    );
  }
}

// États temporaires anti-CSRF (state -> shop). Suffisant pour un usage
// mono-instance ; expirent après 10 minutes.
const pendingStates = new Map();

export function createState(shop) {
  const state = crypto.randomBytes(16).toString("hex");
  pendingStates.set(state, shop);
  setTimeout(() => pendingStates.delete(state), 10 * 60 * 1000);
  return state;
}

export function consumeState(state) {
  const shop = pendingStates.get(state);
  pendingStates.delete(state);
  return shop;
}

export function buildAuthorizeUrl(shop, state) {
  assertConfigured();
  const redirectUri = `${APP_URL}/auth/callback`;
  const params = new URLSearchParams({
    client_id: API_KEY,
    scope: SCOPES,
    redirect_uri: redirectUri,
    state,
  });
  return `https://${shop}/admin/oauth/authorize?${params.toString()}`;
}

// Vérifie la signature HMAC que Shopify ajoute aux query params du callback OAuth
// (différente de la signature des webhooks, mais basée sur le même Client Secret).
export function verifyOAuthCallback(query) {
  const { hmac, signature, ...rest } = query;
  if (!hmac || !API_SECRET) return false;
  const message = Object.keys(rest)
    .sort()
    .map((key) => `${key}=${Array.isArray(rest[key]) ? rest[key].join(",") : rest[key]}`)
    .join("&");
  const digest = crypto.createHmac("sha256", API_SECRET).update(message).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmac));
  } catch {
    return false;
  }
}

// Échange le code temporaire contre un vrai token d'accès à la boutique,
// et le sauvegarde localement pour que shopify.js puisse l'utiliser ensuite.
export async function exchangeCodeForToken(shop, code) {
  assertConfigured();
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: API_KEY,
      client_secret: API_SECRET,
      code,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Échange OAuth échoué (${res.status}) : ${body}`);
  }
  const data = await res.json();
  saveShopToken(shop, data.access_token);
  return data.access_token;
}
