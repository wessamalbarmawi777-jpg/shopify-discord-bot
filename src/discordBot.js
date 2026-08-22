import "dotenv/config";
import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
} from "discord.js";
import { getOrder, listOrders, updateStatus, flagIssue, resolveIssue, getStats } from "./db.js";
import { STATUS_LABELS, nextStatus } from "./statuses.js";
import { createFulfillmentWithTracking } from "./shopify.js";

const commands = [
  new SlashCommandBuilder()
    .setName("commandes")
    .setDescription("Liste toutes les commandes actives et leur statut"),

  new SlashCommandBuilder()
    .setName("commande")
    .setDescription("Détail d'une commande")
    .addStringOption((o) => o.setName("id").setDescription("Numéro de commande Shopify").setRequired(true)),

  new SlashCommandBuilder()
    .setName("valider-achat")
    .setDescription("Confirme que vous avez acheté le produit chez le fournisseur")
    .addStringOption((o) => o.setName("id").setDescription("Numéro de commande").setRequired(true)),

  new SlashCommandBuilder()
    .setName("recu")
    .setDescription("Confirme que le produit est arrivé chez vous")
    .addStringOption((o) => o.setName("id").setDescription("Numéro de commande").setRequired(true)),

  new SlashCommandBuilder()
    .setName("verifie")
    .setDescription("Confirme que le produit a été vérifié et est prêt à expédier")
    .addStringOption((o) => o.setName("id").setDescription("Numéro de commande").setRequired(true)),

  new SlashCommandBuilder()
    .setName("expedier")
    .setDescription("Ajoute le numéro de suivi et déclenche l'envoi + la notification Shopify au client")
    .addStringOption((o) => o.setName("id").setDescription("Numéro de commande").setRequired(true))
    .addStringOption((o) => o.setName("tracking").setDescription("Numéro de suivi").setRequired(true))
    .addStringOption((o) => o.setName("transporteur").setDescription("Nom du transporteur").setRequired(false)),

  new SlashCommandBuilder()
    .setName("probleme")
    .setDescription("Signale un litige sur une commande (jamais résolu automatiquement)")
    .addStringOption((o) => o.setName("id").setDescription("Numéro de commande").setRequired(true))
    .addStringOption((o) => o.setName("note").setDescription("Description du problème").setRequired(true)),

  new SlashCommandBuilder()
    .setName("resoudre")
    .setDescription("Enregistre votre décision sur un litige")
    .addStringOption((o) => o.setName("id").setDescription("Numéro de commande").setRequired(true))
    .addStringOption((o) =>
      o
        .setName("decision")
        .setDescription("Décision prise")
        .setRequired(true)
        .addChoices(
          { name: "Remboursement", value: "remboursement" },
          { name: "Remplacement", value: "remplacement" },
          { name: "Autre solution", value: "autre solution" }
        )
    ),

  new SlashCommandBuilder()
    .setName("stats")
    .setDescription("Statistiques rapides sur les commandes"),
].map((c) => c.toJSON());

export async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_BOT_TOKEN);
  await rest.put(
    Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.DISCORD_GUILD_ID),
    { body: commands }
  );
  console.log("Commandes slash Discord enregistrées.");
}

function orderEmbed(order) {
  return new EmbedBuilder()
    .setTitle(`Commande #${order.id}`)
    .setDescription(order.product || "Produit inconnu")
    .addFields(
      { name: "Client", value: order.customerName || "—", inline: true },
      { name: "Adresse", value: order.address || "—", inline: true },
      { name: "Statut", value: STATUS_LABELS[order.status] || order.status, inline: false },
      ...(order.total ? [{ name: "Total", value: `${order.total} ${order.currency || "EUR"}`, inline: true }] : []),
      ...(order.paymentStatus ? [{ name: "Paiement", value: order.paymentStatus, inline: true }] : []),
      ...(order.shippingCountry ? [{ name: "Livraison", value: order.shippingCountry, inline: true }] : []),
      ...(order.tracking ? [{ name: "Suivi", value: order.tracking, inline: false }] : [])
    )
    .setColor(order.issue && !order.issue.resolved ? 0xb23a2e : 0x3f6b4f);
}

export async function postNewOrderAlert(client, order) {
  const channel = await client.channels.fetch(process.env.DISCORD_ORDERS_CHANNEL_ID);
  await channel.send({
    content: `🛒 **Nouvelle commande #${order.shopifyOrderNumber || order.id}**`,
    embeds: [orderEmbed(order)],
  });
}

export async function postPaidAlert(client, order) {
  const channel = await client.channels.fetch(process.env.DISCORD_ORDERS_CHANNEL_ID);
  await channel.send(
    `💳 Commande #${order.shopifyOrderNumber || order.id} **payée** — ${order.total || "?"} ${order.currency || ""}`
  );
}

export async function postCancelledAlert(client, order, reason) {
  const channel = await client.channels.fetch(process.env.DISCORD_ORDERS_CHANNEL_ID);
  await channel.send(
    `❌ Commande #${order.shopifyOrderNumber || order.id} **annulée**${reason ? ` — motif : ${reason}` : ""}`
  );
}

export async function postUpdatedAlert(client, order) {
  const channel = await client.channels.fetch(process.env.DISCORD_ORDERS_CHANNEL_ID);
  await channel.send(`🔄 Commande #${order.shopifyOrderNumber || order.id} **modifiée**`);
}

export async function postFulfilledAlert(client, order, partial = false) {
  const channel = await client.channels.fetch(process.env.DISCORD_ORDERS_CHANNEL_ID);
  await channel.send(
    partial
      ? `📦 Commande #${order.shopifyOrderNumber || order.id} **partiellement expédiée**`
      : `📦 Commande #${order.shopifyOrderNumber || order.id} **expédiée**`
  );
}

export async function postNewCustomerAlert(client, customer) {
  const channel = await client.channels.fetch(process.env.DISCORD_ORDERS_CHANNEL_ID);
  await channel.send(
    `👤 **Nouveau client** : ${customer.name || "—"}${customer.email ? ` (${customer.email})` : ""}`
  );
}

export function createDiscordClient() {
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    const id = interaction.options.getString("id");

    try {
      switch (interaction.commandName) {
        case "commandes": {
          const orders = listOrders({ activeOnly: true });
          if (orders.length === 0) {
            await interaction.reply("Aucune commande active pour le moment.");
            return;
          }
          const lines = orders.map(
            (o) => `#${o.id} — ${o.product} — ${STATUS_LABELS[o.status] || o.status}${o.issue && !o.issue.resolved ? " ⚠️ litige" : ""}`
          );
          await interaction.reply(lines.join("\n"));
          return;
        }

        case "commande": {
          const order = getOrder(id);
          if (!order) return void (await interaction.reply(`Commande #${id} introuvable.`));
          await interaction.reply({ embeds: [orderEmbed(order)] });
          return;
        }

        case "valider-achat":
        case "recu":
        case "verifie": {
          const order = getOrder(id);
          if (!order) return void (await interaction.reply(`Commande #${id} introuvable.`));
          const targetStatus =
            interaction.commandName === "valider-achat"
              ? "achete"
              : interaction.commandName === "recu"
              ? "recu"
              : "verifie";
          const updated = updateStatus(id, targetStatus);
          await interaction.reply({
            content: `Commande #${id} → **${STATUS_LABELS[updated.status]}**`,
            embeds: [orderEmbed(updated)],
          });
          return;
        }

        case "expedier": {
          const order = getOrder(id);
          if (!order) return void (await interaction.reply(`Commande #${id} introuvable.`));
          if (order.status !== "verifie") {
            await interaction.reply(
              `⚠️ La commande #${id} n'est pas encore au statut "vérifié". Confirmez d'abord la vérification avec /verifie.`
            );
            return;
          }
          await interaction.deferReply();
          const tracking = interaction.options.getString("tracking");
          const transporteur = interaction.options.getString("transporteur") || "Autre";

          await createFulfillmentWithTracking({
            orderId: id,
            trackingNumber: tracking,
            trackingCompany: transporteur,
            notifyCustomer: true,
          });

          const updated = updateStatus(id, "expedie");
          updated.tracking = tracking;
          await interaction.editReply({
            content: `📮 Commande #${id} expédiée. Shopify a envoyé la notification au client automatiquement.`,
            embeds: [orderEmbed(updated)],
          });
          return;
        }

        case "probleme": {
          const note = interaction.options.getString("note");
          const updated = flagIssue(id, note);
          if (!updated) return void (await interaction.reply(`Commande #${id} introuvable.`));
          await interaction.reply({
            content: `🚨 Litige enregistré sur #${id}. Aucune action automatique ne sera prise — décidez avec /resoudre.`,
            embeds: [orderEmbed(updated)],
          });
          return;
        }

        case "resoudre": {
          const decision = interaction.options.getString("decision");
          const updated = resolveIssue(id, decision);
          if (!updated) return void (await interaction.reply(`Pas de litige ouvert pour #${id}.`));
          await interaction.reply(`✅ Décision enregistrée pour #${id} : **${decision}**.`);
          return;
        }

        case "stats": {
          const s = getStats();
          const statusLines = Object.entries(s.byStatus)
            .map(([status, count]) => `• ${STATUS_LABELS[status] || status} : ${count}`)
            .join("\n") || "—";
          await interaction.reply(
            `📊 **Statistiques**\n` +
              `Commandes totales : ${s.totalOrders}\n` +
              `Commandes payées : ${s.paidOrders}\n` +
              `Chiffre d'affaires (payé) : ${s.revenue.toFixed(2)} €\n` +
              `Litiges ouverts : ${s.openIssues}\n` +
              `Clients enregistrés : ${s.totalCustomers}\n\n` +
              `**Par statut**\n${statusLines}`
          );
          return;
        }
      }
    } catch (err) {
      console.error(err);
      const msg = `Erreur : ${err.message}`;
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(msg);
      } else {
        await interaction.reply(msg);
      }
    }
  });

  return client;
}

