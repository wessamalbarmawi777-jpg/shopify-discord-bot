import "dotenv/config";
import express from "express";
import crypto from "crypto";
import { upsertOrder, recordCustomer, getOrder } from "./db.js";
import {
  buildAuthorizeUrl,
  verifyOAuthCallback,
  exchangeCodeForToken,
  createState,
  consumeState,
} from "./oauth.js";
import {
  createDiscordClient,
  registerCommands,
  postNewOrderAlert,
  postPaidAlert,
  postCancelledAlert,
  postUpdatedAlert,
  postFulfilledAlert,
  postNewCustomerAlert,
} from "./discordBot.js";

const app = express();

app.use(express.raw({ type: "application/json" }));

function verifyShopifyWebhook(req) {
  const hmacHeader = req.get("X-Shopify-Hmac-Sha256");
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  if (!hmacHeader || !secret) return false;
  const digest = crypto.createHmac("sha256", secret).update(req.body).digest("base64");
  try {
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmacHeader));
  } catch {
    return false;
  }
}

let discordClient;

function orderFromPayload(payload, { isNew }) {
  const lineItemsText = (payload.line_items || [])
    .map((li) => `${li.title} ×${li.quantity}`)
    .join(", ");
  return upsertOrder({
    id: String(payload.id),
    shopifyOrderNumber: payload.order_number,
    product: lineItemsText || "Produit inconnu",
    customerName: `${payload.customer?.first_name || ""} ${payload.customer?.last_name || ""}`.trim(),
    address: payload.shipping_address
      ? `${payload.shipping_address.address1}, ${payload.shipping_address.city}`
      : "—",
    total: payload.total_price,
    currency: payload.currency,
    paymentStatus: payload.financial_status,
    shippingCountry: payload.shipping_address?.country,
    ...(isNew ? { status: "en_attente_achat" } : {}),
  });
}

function webhookRoute(handler) {
  return async (req, res) => {
    if (!verifyShopifyWebhook(req)) {
      console.warn("Webhook Shopify refusé : signature invalide.");
      return res.status(401).send("Invalid signature");
    }
    res.status(200).send("OK");
    try {
      const payload = JSON.parse(req.body.toString("utf-8"));
      await handler(payload);
    } catch (err) {
      console.error("Erreur de traitement webhook :", err.message);
    }
  };
}

app.post(
  "/webhooks/orders-create",
  webhookRoute(async (payload) => {
    const order = orderFromPayload(payload, { isNew: true });
    if (discordClient) await postNewOrderAlert(discordClient, order);
  })
);

app.post(
  "/webhooks/orders-paid",
  webhookRoute(async (payload) => {
    const existing = getOrder(String(payload.id));
    const order = orderFromPayload(payload, { isNew: !existing });
    if (discordClient) await postPaidAlert(discordClient, order);
  })
);

app.post(
  "/webhooks/orders-cancelled",
  webhookRoute(async (payload) => {
    const existing = getOrder(String(payload.id));
    const order = orderFromPayload(payload, { isNew: !existing });
    if (discordClient) await postCancelledAlert(discordClient, order, payload.cancel_reason);
  })
);

app.post(
  "/webhooks/orders-updated",
  webhookRoute(async (payload) => {
    const existing = getOrder(String(payload.id));
    const order = orderFromPayload(payload, { isNew: !existing });
    if (discordClient) {
      if (payload.fulfillment_status === "partial") {
        await postFulfilledAlert(discordClient, order, true);
      } else {
        await postUpdatedAlert(discordClient, order);
      }
    }
  })
);

app.post(
  "/webhooks/orders-fulfilled",
  webhookRoute(async (payload) => {
    const existing = getOrder(String(payload.id));
    const order = orderFromPayload(payload, { isNew: !existing });
    if (discordClient) await postFulfilledAlert(discordClient, order, false);
  })
);

app.post(
  "/webhooks/customers-create",
  webhookRoute(async (payload) => {
    const customer = recordCustomer({
      id: String(payload.id),
      name: `${payload.first_name || ""} ${payload.last_name || ""}`.trim(),
      email: payload.email,
    });
    if (discordClient) await postNewCustomerAlert(discordClient, customer);
  })
);

app.get("/health", (_req, res) => res.send("ok"));

app.get("/debug/config", (_req, res) => {
  const raw = process.env.SHOPIFY_APP_URL || "";
  const match = raw.match(/^https?:\/\/[^/\s]+/);
  const clean = match ? match[0] : null;
  res.json({
    rawLength: raw.length,
    cleanAppUrl: clean,
    redirectUri: clean ? `${clean}/auth/callback` : null,
  });
});

app.get("/auth", (req, res) => {
  const shop = req.query.shop;
  if (!shop || !/^[a-z0-9-]+\.myshopify\.com$/.test(shop)) {
    return res.status(400).send("Paramètre ?shop=xxxxx.myshopify.com manquant ou invalide.");
  }
  const state = createState(shop);
  res.redirect(buildAuthorizeUrl(shop, state));
});

app.get("/auth/callback", async (req, res) => {
  const { shop, code, state } = req.query;
  if (!shop || !code || !state) {
    return res.status(400).send("Paramètres manquants dans le callback OAuth.");
  }
  if (!verifyOAuthCallback(req.query)) {
    return res.status(401).send("Signature invalide.");
  }
  const expectedShop = consumeState(state);
  if (expectedShop !== shop) {
    return res.status(401).send("State invalide ou expiré, relancez /auth?shop=...");
  }
  try {
    await exchangeCodeForToken(shop, code);
    res.send("✅ Application installée avec succès pour " + shop + ". Vous pouvez fermer cette page.");
  } catch (err) {
    console.error("Erreur d'échange OAuth :", err.message);
    res.status(500).send("Échec de l'installation : " + err.message);
  }
});

async function main() {
  discordClient = createDiscordClient();
  await discordClient.login(process.env.DISCORD_BOT_TOKEN);
  await registerCommands();

  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`Serveur webhook Shopify en écoute sur le port ${port}`);
  });
}

main().catch((err) => {
  console.error("Erreur au démarrage :", err);
  process.exit(1);
});
