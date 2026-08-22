import "dotenv/config";
import { getShopToken } from "./db.js";

const API_VERSION = process.env.SHOPIFY_API_VERSION || "2024-10";

// Boutique par défaut utilisée si on n'en précise pas une explicitement
// (pratique tant qu'on ne gère qu'une seule boutique depuis Discord).
function defaultShop() {
  const store = process.env.SHOPIFY_STORE;
  if (!store) throw new Error("SHOPIFY_STORE doit être défini dans .env (ex: maboutique).");
  return `${store}.myshopify.com`;
}

function baseUrl(shop) {
  return `https://${shop}/admin/api/${API_VERSION}`;
}

async function shopifyFetch(shop, pathname, options = {}) {
  const token = getShopToken(shop);
  if (!token) {
    throw new Error(
      `Aucun token d'accès enregistré pour ${shop}. Installez l'app via /auth?shop=${shop} avant d'appeler l'API Shopify.`
    );
  }
  const res = await fetch(`${baseUrl(shop)}${pathname}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Shopify API ${res.status} sur ${pathname} : ${body}`);
  }
  return res.json();
}

export async function getOrder(orderId, shop = defaultShop()) {
  const data = await shopifyFetch(shop, `/orders/${orderId}.json`);
  return data.order;
}

// Récupère l'ID de la fulfillment order liée à la commande (nécessaire
// pour créer un fulfillment avec l'API récente).
export async function getFulfillmentOrderId(orderId, shop = defaultShop()) {
  const data = await shopifyFetch(shop, `/orders/${orderId}/fulfillment_orders.json`);
  const fo = data.fulfillment_orders?.[0];
  if (!fo) throw new Error(`Aucune fulfillment order trouvée pour la commande ${orderId}`);
  return fo.id;
}

// Crée le fulfillment avec le numéro de suivi.
// C'est CETTE étape qui déclenche l'email natif Shopify "Votre commande est en route"
// envoyé au client — le bot n'a jamais besoin d'écrire ce message lui-même.
export async function createFulfillmentWithTracking({
  orderId,
  trackingNumber,
  trackingCompany = "Autre",
  trackingUrl,
  notifyCustomer = true,
  shop = defaultShop(),
}) {
  const fulfillmentOrderId = await getFulfillmentOrderId(orderId, shop);
  const body = {
    fulfillment: {
      line_items_by_fulfillment_order: [{ fulfillment_order_id: fulfillmentOrderId }],
      tracking_info: {
        number: trackingNumber,
        company: trackingCompany,
        url: trackingUrl,
      },
      notify_customer: notifyCustomer,
    },
  };
  const data = await shopifyFetch(shop, `/fulfillments.json`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return data.fulfillment;
}
