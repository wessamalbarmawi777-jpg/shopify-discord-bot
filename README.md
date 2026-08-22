# Bot Discord — automatisation des commandes Shopify

Ce bot :
1. reçoit une notification instantanée (webhook) dès qu'une commande est passée sur Shopify,
2. la poste dans un salon Discord,
3. vous laisse piloter tout le pipeline (achat → transit → reçu → vérifié → expédié) avec des commandes slash,
4. déclenche l'envoi réel du numéro de suivi côté Shopify — ce qui envoie automatiquement l'email "commande en route" au client, sans que le bot n'écrive lui-même ce message.

Rien n'est acheté ou remboursé automatiquement : chaque étape sensible attend votre commande explicite.

## 0. Créer ta boutique de test (Shopify Partners)

Si ce n'est pas déjà fait : https://partners.shopify.com → crée ton organisation partenaire (gratuit) → **Boutiques > Ajouter une boutique > Boutique de développement**. C'est cette boutique de test qui te donne le `xxxxx.myshopify.com` à utiliser comme `SHOPIFY_STORE`.

## 1. Connecter l'app Shopify (OAuth)

Ton app **NAYTIX** est déjà créée dans le Dev Dashboard avec un Client ID et un Client Secret — ils sont déjà dans `.env` (`SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET`).

Contrairement à l'ancien système (token statique copié une fois), cette app s'installe via un vrai flux d'autorisation :

1. Complète dans `.env` :
   - `SHOPIFY_STORE` = le nom de ta boutique (ex: `maboutique`)
   - `SHOPIFY_APP_URL` = l'URL publique de ton serveur une fois hébergé (étape 5 ci-dessous), ex: `https://mon-bot.up.railway.app`
2. Une fois le serveur démarré, ouvre dans un navigateur :
   `https://<SHOPIFY_APP_URL>/auth?shop=<SHOPIFY_STORE>.myshopify.com`
3. Shopify affiche l'écran "Autoriser NAYTIX à accéder à votre boutique" → clique **Installer l'application**
4. Tu es redirigé vers `/auth/callback`, qui échange automatiquement le code contre un vrai token et l'enregistre — tu verras "✅ Application installée avec succès"

Le token est ensuite stocké localement (`db.json`) et utilisé automatiquement par le bot. Si tu changes de boutique ou que le token expire, il suffit de refaire l'étape 2.

## 2. Créer le salon Discord dédié

Dans ton serveur Discord, crée une catégorie et un salon, par exemple :


Ensuite, dans les **Paramètres du salon > Permissions**, ajoute le rôle du bot et donne-lui au minimum :
- Voir le salon
- Envoyer des messages
- Intégrer des liens / Joindre des fichiers (pour les embeds)

C'est l'ID de ce salon qu'on met dans `DISCORD_ORDERS_CHANNEL_ID` (étape suivante).

## 3. Créer les webhooks Shopify

Shopify doit appeler une URL HTTPS de ton serveur à chaque événement. Crée un webhook par événement dans **Paramètres > Notifications > Webhooks** (format JSON) :

| Événement Shopify | URL à renseigner | Ce qui est posté sur Discord |
|---|---|---|
| Création de commande | `.../webhooks/orders-create` | 🛒 Nouvelle commande #1052 — client, produits, total, paiement, livraison |
| Commande payée | `.../webhooks/orders-paid` | 💳 Commande #1052 payée — montant |
| Commande annulée | `.../webhooks/orders-cancelled` | ❌ Commande #1052 annulée — motif |
| Commande modifiée | `.../webhooks/orders-updated` | 🔄 Commande #1052 modifiée (ou 📦 partiellement expédiée si Shopify le signale via cet événement) |
| Commande exécutée (expédiée) | `.../webhooks/orders-fulfilled` | 📦 Commande #1052 expédiée |
| Création de client | `.../webhooks/customers-create` | 👤 Nouveau client : nom (email) |

Shopify donne une clé secrète par webhook — comme ils sont tous vérifiés avec la même signature, mets la même valeur dans `SHOPIFY_WEBHOOK_SECRET` pour chacun (ou régénère `SHOPIFY_WEBHOOK_SECRET` à partir de n'importe lequel, ils partagent le secret de l'app).

> Le serveur doit être accessible publiquement. En local pour tester, utilise `ngrok http 3000` et remplace `<votre-domaine>` par l'URL ngrok dans chaque webhook.

> Shopify n'a pas d'événement dédié "commande partiellement expédiée" : c'est repéré automatiquement dans `orders-updated` en regardant `fulfillment_status`. Pas de configuration supplémentaire à faire.

## 4. Créer le bot Discord

1. https://discord.com/developers/applications → **New Application**
2. Onglet **Bot** → crée le bot → copie le token → `DISCORD_BOT_TOKEN`
3. Copie l'**Application ID** → `DISCORD_CLIENT_ID`
4. Invite le bot sur ton serveur avec les scopes `bot` + `applications.commands` et la permission "Envoyer des messages"
5. `DISCORD_GUILD_ID` = clic droit sur ton serveur Discord (mode développeur activé) > Copier l'ID
6. `DISCORD_ORDERS_CHANNEL_ID` = clic droit sur le salon `🛒・commandes` créé à l'étape 2 > Copier l'ID

## 4. Lancer le bot

```bash
cp .env.example .env
# remplis toutes les valeurs dans .env
npm install
npm start
