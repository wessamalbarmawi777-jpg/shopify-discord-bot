// Pipeline interne — ne correspond pas 1:1 aux statuts Shopify natifs,
// car Shopify ne connaît pas "achat fournisseur" ou "produit vérifié".
// On garde ça en local (db.json) et on ne touche à Shopify que pour
// le fulfillment final (numéro de suivi -> déclenche l'email Shopify natif).

export const STATUSES = [
  "en_attente_achat",   // commande détectée, achat fournisseur pas encore fait
  "achete",              // vous avez acheté chez le fournisseur
  "en_transit_vers_nous",
  "recu",                // colis arrivé chez vous
  "verifie",             // vous avez vérifié le produit
  "expedie",              // vous avez expédié + tracking ajouté (fulfillment Shopify créé)
  "termine",
];

export const STATUS_LABELS = {
  en_attente_achat: "⏳ En attente d'achat",
  achete: "🛒 Acheté chez le fournisseur",
  en_transit_vers_nous: "🚚 En transit vers nous",
  recu: "📦 Reçu",
  verifie: "✅ Vérifié",
  expedie: "📮 Expédié au client",
  termine: "🏁 Terminé",
};

export function nextStatus(current) {
  const idx = STATUSES.indexOf(current);
  if (idx === -1 || idx === STATUSES.length - 1) return current;
  return STATUSES[idx + 1];
}
