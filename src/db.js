import { readFileSync, writeFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, "..", "db.json");

function load() {
  if (!existsSync(DB_PATH)) {
    writeFileSync(DB_PATH, JSON.stringify({ orders: {}, customers: {}, shops: {} }, null, 2));
  }
  const data = JSON.parse(readFileSync(DB_PATH, "utf-8"));
  if (!data.customers) data.customers = {};
  if (!data.shops) data.shops = {};
  return data;
}

function save(data) {
  writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

export function upsertOrder(order) {
  const data = load();
  data.orders[order.id] = { ...(data.orders[order.id] || {}), ...order };
  save(data);
  return data.orders[order.id];
}

export function getOrder(id) {
  const data = load();
  return data.orders[id] || null;
}

export function listOrders({ activeOnly = true } = {}) {
  const data = load();
  const all = Object.values(data.orders);
  return activeOnly ? all.filter((o) => o.status !== "termine") : all;
}

export function updateStatus(id, status) {
  const data = load();
  if (!data.orders[id]) return null;
  data.orders[id].status = status;
  save(data);
  return data.orders[id];
}

export function flagIssue(id, note) {
  const data = load();
  if (!data.orders[id]) return null;
  data.orders[id].issue = { note, resolved: null, createdAt: new Date().toISOString() };
  save(data);
  return data.orders[id];
}

export function resolveIssue(id, decision) {
  const data = load();
  if (!data.orders[id] || !data.orders[id].issue) return null;
  data.orders[id].issue.resolved = decision;
  save(data);
  return data.orders[id];
}

export function recordCustomer(customer) {
  const data = load();
  data.customers[customer.id] = { ...(data.customers[customer.id] || {}), ...customer };
  save(data);
  return data.customers[customer.id];
}

export function getStats() {
  const data = load();
  const orders = Object.values(data.orders);
  const paidOrders = orders.filter((o) => o.paymentStatus === "paid");
  const revenue = paidOrders.reduce((sum, o) => sum + (Number(o.total) || 0), 0);
  const openIssues = orders.filter((o) => o.issue && !o.issue.resolved).length;
  const byStatus = orders.reduce((acc, o) => {
    acc[o.status] = (acc[o.status] || 0) + 1;
    return acc;
  }, {});
  return {
    totalOrders: orders.length,
    paidOrders: paidOrders.length,
    revenue,
    openIssues,
    totalCustomers: Object.keys(data.customers).length,
    byStatus,
  };
}

// --- Tokens OAuth par boutique (flux "app Shopify" avec Client ID / Client Secret) ---
export function saveShopToken(shop, accessToken) {
  const data = load();
  data.shops[shop] = { ...(data.shops[shop] || {}), accessToken, connectedAt: new Date().toISOString() };
  save(data);
  return data.shops[shop];
}

export function getShopToken(shop) {
  const data = load();
  return data.shops[shop]?.accessToken || null;
}
