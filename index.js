function splitEmbedDescription(desc, maxLen = 4096) {
  const lines = desc.split('\n');
  const chunks = [];
  let current = '';
  for (const line of lines) {
    if ((current + line + '\n').length > maxLen) {
      chunks.push(current);
      current = '';
    }
    current += line + '\n';
  }
  if (current) chunks.push(current);
  return chunks;
}
const normalizer = require('./fontNormalizer');
require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, REST, Routes, SlashCommandBuilder } = require("discord.js");
const fs = require("fs");
const Fuse = require("fuse.js");
const inviteChecker = require('./invite.js'); // Assumes invite.js exports async function checkInvite(link)

const TOKEN = process.env.TOKEN;
const JSON_FILE = "./DBTag.json";
const FONTED_FILE = "./Fonted.json";

const ALLOWED_ROLE_ID = "1373976275953385513";

const SYMBOLS = [
  "<3", ":3", ";(", ":p", ":D", ":P", ":/", ";p"
];

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessages,
  ],
});

const LOGGING_CHANNEL_ID = "1373983013087613049";

const NOT_FOUND_FILE = "./notFoundTags.json";
const NOT_FOUND_EMBED_FILE = "./notFoundEmbedMsg.json";

// === NEW: Search History and Disabled Channels ===
const HISTORY_FILE = "./history.json";
const DISABLED_CHANNELS_FILE = "./disabledChannels.json";
function loadHistory() {
  try { return JSON.parse(fs.readFileSync(HISTORY_FILE)); } catch { return { users: {}, global: {} }; }
}
function saveHistory(obj) {
  try { fs.writeFileSync(HISTORY_FILE, JSON.stringify(obj, null, 2)); return true; } catch { return false; }
}
function loadDisabledChannels() {
  try { return JSON.parse(fs.readFileSync(DISABLED_CHANNELS_FILE)); } catch { return []; }
}
function saveDisabledChannels(arr) {
  try { fs.writeFileSync(DISABLED_CHANNELS_FILE, JSON.stringify(arr, null, 2)); return true; } catch { return false; }
}

// === NEW: First-time search user map (in-memory, resets on restart) ===
const firstTimeSearchMap = new Set();

function loadNotFoundTags() {
  try {
    return JSON.parse(fs.readFileSync(NOT_FOUND_FILE, "utf8"));
  } catch {
    return {};
  }
}
function saveNotFoundTags(obj) {
  try {
    fs.writeFileSync(NOT_FOUND_FILE, JSON.stringify(obj, null, 2));
    return true;
  } catch {
    return false;
  }
}
function tagShouldBeLogged(tag) {
  return tag.length <= 5;
}
async function updateNotFoundEmbed(channel) {
  const notFound = loadNotFoundTags();
  const sorted = Object.entries(notFound)
    .filter(([tag]) => tagShouldBeLogged(tag))
    .sort((a, b) => b[1] - a[1]);
  if (!sorted.length) return;

  const desc = sorted.map(([tag, count], i) =>
    `**${i + 1}.** \`${tag}\` — **${count}** time(s)`
  ).join("\n");

  const embed = new EmbedBuilder()
    .setTitle("Top Not Found Tags (≤5 letters)")
    .setDescription(desc)
    .setColor(0xff0000)
    .setFooter({ text: "Leaderboard of tags users searched but were NOT found." });

  let msgId;
  try {
    msgId = JSON.parse(fs.readFileSync(NOT_FOUND_EMBED_FILE, "utf8")).msgId;
  } catch {
    msgId = null;
  }
  let sentMsg;
  if (msgId) {
    try {
      sentMsg = await channel.messages.fetch(msgId);
      await sentMsg.edit({ embeds: [embed] });
    } catch {
      sentMsg = await channel.send({ embeds: [embed] });
      fs.writeFileSync(NOT_FOUND_EMBED_FILE, JSON.stringify({ msgId: sentMsg.id }, null, 2));
    }
  } else {
    sentMsg = await channel.send({ embeds: [embed] });
    fs.writeFileSync(NOT_FOUND_EMBED_FILE, JSON.stringify({ msgId: sentMsg.id }, null, 2));
  }
  return sentMsg;
}
client.on("messageDelete", async (msg) => {
  if (msg.channelId !== LOGGING_CHANNEL_ID) return;
  let msgId;
  try {
    msgId = JSON.parse(fs.readFileSync(NOT_FOUND_EMBED_FILE, "utf8")).msgId;
  } catch {
    return;
  }
  if (msg.id === msgId) {
    const channel = await client.channels.fetch(LOGGING_CHANNEL_ID);
    await updateNotFoundEmbed(channel);
  }
});

client.once("ready", () => {
  if (client.user) {
    console.log(`online as ${client.user.tag}`);
  } else {
    console.log("online as (unknown bot user)");
  }
});

const rest = new REST({ version: "10" }).setToken(TOKEN);
(async () => {
  try {
    await rest.put(Routes.applicationCommands(client.user?.id || "me"), {
      body: [
        new SlashCommandBuilder()
          .setName("addtag")
          .setDescription("Add a new tag with name and url")
          .addStringOption(option =>
            option.setName("input")
              .setDescription("Format: Tag_name, Tag_url")
              .setRequired(true)
          )
          .toJSON(),
      ],
    });
  } catch {}
})();

function loadTags() {
  try {
    const rawData = fs.readFileSync(JSON_FILE);
    return JSON.parse(rawData);
  } catch {
    return [];
  }
}

// --- LOAD FONTED TAGS ---
function loadFontedTags() {
  try {
    const rawData = fs.readFileSync(FONTED_FILE);
    return JSON.parse(rawData);
  } catch {
    return [];
  }
}

function saveTags(tags) {
  try {
    fs.writeFileSync(JSON_FILE, JSON.stringify(tags, null, 2));
    return true;
  } catch {
    return false;
  }
}

function searchTagsFuzzy(query, tags) {
  const fuse = new Fuse(tags, {
    keys: ['name'],
    threshold: 0.4,
    includeScore: true,
    distance: 100,
    minMatchCharLength: 2,
  });
  return fuse.search(query).map(res => res.item);
}

function getRandomColor() {
  const colors = [0xffa500, 0x1e90ff, 0x32cd32, 0xff69b4, 0x9370db];
  return colors[Math.floor(Math.random() * colors.length)];
}

function buildEmbed(title, description, color) {
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(color);
}

function buildTagDescription(tags, startIndex = 1) {
  return tags.map((t, i) => `${i + startIndex}. **${t.name}**\n${t.link}`).join("\n\n");
}

// --- UPDATED: Unicode-aware search for all DB-stored variants ---
function searchTagsNormalized(query, tags) {
  // If query contains any non-ASCII, match on raw tag name (or keyword for fonted)
  if (/[^\x00-\x7F]/.test(query)) {
    return tags.filter(t => {
      let keyword = t.name;
      if (keyword.includes(':')) keyword = keyword.split(':').pop();
      keyword = keyword.trim();
      return keyword === query || keyword.toLowerCase() === query.toLowerCase();
    });
  }
  // Else, fallback to ASCII-normalized matching
  const normQuery = normalizer.normalizeToAscii(query);
  return tags.filter(t => {
    let keyword = t.name;
    if (keyword.includes(':')) keyword = keyword.split(':').pop();
    keyword = keyword.trim();
    return normalizer.normalizeToAscii(keyword) === normQuery;
  });
}

// --- UPDATED: FONTED KEYWORD SEARCH (Unicode-aware) ---
function searchFontedTagsByKeyword(query, fontedTags) {
  if (/[^\x00-\x7F]/.test(query)) {
    return fontedTags.filter(t =>
      t.keyword &&
      (String(t.keyword) === query || String(t.keyword).toLowerCase() === query.toLowerCase())
    );
  }
  // If ASCII-only, use the old normalizer
  const normQuery = normalizer.normalizeToAscii(query).toUpperCase().trim();
  return fontedTags.filter(t =>
    t.keyword &&
    normalizer.normalizeToAscii(String(t.keyword)).toUpperCase().trim() === normQuery
  );
}

client.on("guildCreate", async (guild) => {
  try {
    const logChannel = await client.channels.fetch(LOGGING_CHANNEL_ID);
    if (!logChannel) return;
    const embed = new EmbedBuilder()
      .setTitle("Bot Added to New Server")
      .addFields(
        { name: "Server Name", value: guild.name, inline: true },
        { name: "Server Members", value: `${guild.memberCount}`, inline: true }
      )
      .setColor(0x1e90ff)
      .setTimestamp();
    await logChannel.send({ embeds: [embed] });
  } catch (err) {
    console.error("Failed to log guild join:", err);
  }
});

// --- UPDATED: !help Command Handler ---
client.on("messageCreate", async (message) => {
  if (
    message.author.bot ||
    typeof message.content !== "string" ||
    message.content.trim().toLowerCase() !== "!help"
  ) return;

  // UPDATED: React to user's message and delete after 5s
  try { await message.react("✅"); } catch(e) {}

  setTimeout(async () => {
    if (message.deletable) { try { await message.delete(); } catch (e) {} }
  }, 5000);

  // UPDATED: Embed as per new spec
  const helpEmbed = new EmbedBuilder()
    .setTitle("#COMMANDS")
    .setDescription(
`**<@1372151527237488680> [Tag Name]**
**Ping the bot and type tag you want to search without brackets)**`
    )
    .addFields(
      { name: "<@1372151527237488680> show chinese tags", value: "**Searches Chinese Tags**" },
      { name: "<@1372151527237488680> show japanese tags", value: "**Searches Japanese Tags**" },
      { name: "<@1372151527237488680> show symbols", value: "**Searches Symbols (<3, :p, :3)**" },
      { name: "<@1372151527237488680> !alltags", value: "**Total tags in database**" },
      { name: "<@1372151527237488680> !check [invite-link]", value: "**checks if invite link is active**" },
      { name: "<@1372151527237488680> at [Tag-Name] [Invite-Code] <:warning:892823499205406760>", value: "**At (Add Tag) Adds a TAG in database**" },
      { name: "<@1372151527237488680> DT [Invite-Link] - <:warning:892823499205406760>", value: "**Deletes TAG from database**" },
      { name: "<@1372151527237488680> RL [Old Invite-Link] [New Invite-Link] <:warning:892823499205406760>", value: "**Replaces Link of TAG**" },
      { name: "Only Users With @BACKEND Role", value: "**Can Use Commands marked With <:warning:892823499205406760>**" }
    )
    .setColor(0xEABFB9) // Yellowish-pink
    .setFooter({ text: 'type !help for commands' });

  await message.author.send({ embeds: [helpEmbed] }).catch(async () => {
    // fallback: send in channel but only mention user
    await message.channel.send({ content: `<@${message.author.id}>`, embeds: [helpEmbed] });
  });
});

// --- !fetch command for logging all guilds ---
client.on("messageCreate", async (message) => {
  if (message.content.startsWith("!fetch")) {
    const args = message.content.split(" ");
    let channelId = args[1] || LOGGING_CHANNEL_ID;
    try {
      const targetChannel = await client.channels.fetch(channelId);
      if (!targetChannel) return message.reply("Invalid channel ID.");
      const guilds = client.guilds.cache.map(guild => ({
        name: guild.name,
        memberCount: guild.memberCount
      }));
      if (guilds.length === 0) return targetChannel.send("The bot is not in any servers.");
      let desc = guilds.map((g, i) => `${i + 1}. **${g.name}** | Members: ${g.memberCount}`).join("\n");
      const embed = new EmbedBuilder()
        .setTitle("Bot Server Logs")
        .setDescription(desc)
        .setColor(0x32cd32)
        .setTimestamp();
      await targetChannel.send({ embeds: [embed] });
      if (message.channelId !== channelId) await message.reply("Logs sent!");
    } catch (e) {
      await message.reply("Failed to send logs. Make sure the channel ID is valid and the bot has access.");
    }
    return;
  }
});

// --- UPDATED: !alltags command (available to everyone, works with mentions) ---
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  // allow: !alltags, @Bot alltags, @bot alltags, ... (case-insensitive)
  let content = message.content.toLowerCase().replace(/\s+/g, " ");
  let botMentionRegex = new RegExp(`^<@!?${client.user?.id}>\\s*!?alltags$`, "i");
  if (
    content.trim() === "!alltags" ||
    botMentionRegex.test(content.trim()) ||
    content.trim().endsWith(" alltags") && message.mentions.has(client.user)
  ) {
    let dbTags = [], fontedTags = [];
    try { dbTags = JSON.parse(fs.readFileSync(JSON_FILE)); } catch {}
    try { fontedTags = JSON.parse(fs.readFileSync(FONTED_FILE)); } catch {}
    const dbCount = dbTags.length;
    const fontedCount = fontedTags.length;
    const totalCount = dbCount + fontedCount;
    const embed = new EmbedBuilder()
      .setTitle(`📔 Total Tags: ${totalCount}`)
      .setDescription(
        `Current number of Tags in database:\n\n` +
        `**DBTag.json:** ${dbCount}\n` +
        `**Fonted.json:** ${fontedCount}\n\n` +
        `**Total:** ${totalCount}`
      )
      .setColor(0xffd700);
    await message.channel.send({ embeds: [embed] });
    return;
  }
});

// --- !check <invite> for ANYONE
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (!message.content.toLowerCase().startsWith("!check ")) return;
  const args = message.content.split(/\s+/);
  if (args.length < 2) return;
  let link = args[1].trim();
  if (!/^https?:\/\//.test(link)) link = "https://discord.gg/" + link;
  const sent = await message.channel.send({ embeds: [
    buildEmbed(`<a:loading:1373152608759582771> Checking...`, `Checking invite link:\n${link}`, 0x808080)
  ]});
  try {
    const res = await inviteChecker.checkInvite(link);
    if (res && res.valid) {
      await sent.edit({ embeds: [
        buildEmbed("✅ Invite Active", `This invite is **active**.\n${link}`, 0x32cd32)
      ]});
    } else {
      await sent.edit({ embeds: [
        buildEmbed("🔴 Invite Expired", `This invite is **expired or invalid**.\n${link}`, 0xff0000)
      ]});
    }
  } catch (e) {
    await sent.edit({ embeds: [
      buildEmbed("Error", "Failed to check invite (rate limited or error). Try again later.", 0xff0000)
    ]});
  }
});
// --- !invitereport (role-restricted, fast concurrent version!)
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (message.content.trim().toLowerCase() !== "!invitereport") return;
  if (!message.member || !message.member.roles.cache.has(ALLOWED_ROLE_ID)) {
    return message.reply({ embeds: [
      buildEmbed("❌ Permission Denied", "You do not have permission to use this command.", 0xff0000)
    ]});
  }
  let dbTags = [], fontedTags = [];
  try { dbTags = JSON.parse(fs.readFileSync(JSON_FILE)); } catch {}
  try { fontedTags = JSON.parse(fs.readFileSync(FONTED_FILE)); } catch {}

  const linkList = [];
  dbTags.forEach(tag => linkList.push({ link: tag.link, tag: tag.name, source: "DBTag.json" }));
  fontedTags.forEach(tag => linkList.push({ link: tag.link, tag: tag.name, source: "Fonted.json" }));
  const total = linkList.length;

  let checked = 0;
  let invalid = [];
  const sent = await message.channel.send({ embeds: [
    buildEmbed(`<a:loading:1373152608759582771> Invite Report`, `Starting check on **${total}** invites...\nProgress: 0/${total}`, 0x808080)
  ]});

  async function processWithConcurrency(tasks, worker, concurrency = 20, progressCb) {
    let idx = 0, running = 0, finished = 0;
    let results = new Array(tasks.length);
    let startTime = Date.now();
    return new Promise((resolve) => {
      function next() {
        while (running < concurrency && idx < tasks.length) {
          const thisIdx = idx++;
          running++;
          worker(tasks[thisIdx], thisIdx)
            .then(result => {
              results[thisIdx] = result;
              finished++;
              running--;
              if (progressCb) {
                const elapsed = (Date.now() - startTime) / 1000;
                const rate = finished / (elapsed || 1e-6);
                const estLeft = Math.max(1, Math.round((tasks.length - finished) / (rate || 1)));
                progressCb(finished, tasks.length, estLeft);
              }
              next();
            });
        }
        if (idx >= tasks.length && running === 0) resolve(results);
      }
      next();
    });
  }

  let lastProgress = 0;
  await processWithConcurrency(
    linkList,
    async (item, i) => {
      let retry = 0, valid = null;
      while (retry < 2 && valid === null) {
        try {
          let res = await inviteChecker.checkInvite(item.link);
          valid = res && res.valid;
        } catch {
          valid = null;
          await new Promise(res => setTimeout(res, 800 * (retry + 1)));
        }
        retry++;
      }
      return { ...item, valid };
    },
    20,
    async (checkedCount, totalCount, etaSec) => {
      if (checkedCount % 10 === 0 || checkedCount === totalCount) {
        if (checkedCount !== lastProgress) {
          lastProgress = checkedCount;
          try {
            await sent.edit({ embeds: [
              buildEmbed(
                `<a:loading:1373152608759582771> Invite Report`,
                `Progress: ${checkedCount}/${totalCount}\nEstimated time left: ${etaSec}s`,
                0x808080
              )
            ]});
          } catch {}
        }
      }
    }
  ).then(results => {
    checked = results.length;
    invalid = results.filter(r => r.valid === false);
  });

let desc = `Checked **${total}** invites.\nInvalid: **${invalid.length}**`;
if (invalid.length > 0) {
  desc += "\n\n**Invalid Invites:**\n";
  desc += invalid.map((x, i) => `${i+1}. ${x.tag} (${x.source})\n${x.link}`).join('\n');
} else {
  desc += "\n\nAll invites are valid!";
}

const descChunks = splitEmbedDescription(desc);

await sent.edit({ embeds: [buildEmbed(`📋 Invite Report`, descChunks[0], invalid.length ? 0xffa500 : 0x32cd32)] });

for (let i = 1; i < descChunks.length; ++i) {
  await message.channel.send({ embeds: [buildEmbed(`📋 Invite Report (cont.)`, descChunks[i], 0xffa500)] });
}                           
});
// ----- INTERACTION HANDLER (Slash Command Addtag) -----
client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName === "addtag") {
    const input = interaction.options.getString("input");
    if (!input.includes(",")) {
      await interaction.reply({ content: "Invalid format. Use: Tag_name, Tag_url", ephemeral: true });
      return;
    }
    const [nameRaw, linkRaw] = input.split(",");
    const name = `> Tags: ${nameRaw.trim()}`;
    let link = linkRaw.trim();
    if (/^[\w\d]{6,}/.test(link) && !/^https?:\/\//i.test(link)) {
      link = "https://discord.gg/" + link;
    }
    if (!name || !link) {
      await interaction.reply({ content: "Both tag name and URL must be provided.", ephemeral: true });
      return;
    }
    const tags = loadTags();
    tags.push({ name, link });
    if (saveTags(tags)) {
      await interaction.reply({ content: `Tag **${name}** added successfully!`, ephemeral: true });
    } else {
      await interaction.reply({ content: "Failed to save the tag. Try again later.", ephemeral: true });
    }
  }
});

// --- MAIN BOT MENTION HANDLER ---
// Handles tag search, disables, symbols, history, emoji, etc.
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (!message.mentions.has(client.user)) return;

  // --- NEW: Check if search is disabled in this channel ---
  let disabledChannels = loadDisabledChannels();
  if (disabledChannels.includes(message.channel.id)) {
    // Prompt user to search in another channel, delete their message
    await message.reply({
      embeds: [
        buildEmbed(
          "❌ Search Disabled",
          "Searching is disabled in this channel. Please use the designated search channel.",
          0xff0000
        ),
      ],
    });
    setTimeout(() => { if (message.deletable) message.delete().catch(() => {}); }, 2500);
    return;
  }

  const args = message.content.trim().split(/\s+/);
  const command = args[1]?.toLowerCase() || "";
  const language = args[2]?.toLowerCase() || "";

  // --- NEW: Disable Search in Channel ---
  if (command === "!disable" && (args[2] || args[2]?.match(/^<#\d+>$|^\d+$/))) {
    // Only allow users with manage channels or admin permissions
    if (!message.member.permissions.has("ManageChannels") && !message.member.permissions.has("Administrator")) {
      await message.reply({ embeds: [buildEmbed("❌ Permission Denied", "You need Manage Channels or Admin permission to use this.", 0xff0000)] });
      return;
    }
    let targetChannelId = args[2]?.replace(/[<#>]/g, "");
    if (!targetChannelId) {
      await message.reply({ embeds: [buildEmbed("❌ Error", "Please provide a valid channel mention or channel ID.", 0xff0000)] });
      return;
    }
    if (!disabledChannels.includes(targetChannelId)) {
      disabledChannels.push(targetChannelId);
      saveDisabledChannels(disabledChannels);
      await message.reply({ embeds: [buildEmbed("✅ Search Disabled", `<#${targetChannelId}> is now disabled for searching.`, 0x32cd32)] });
    } else {
      await message.reply({ embeds: [buildEmbed("ℹ️ Already Disabled", `<#${targetChannelId}> is already disabled for searching.`, 0xffa500)] });
    }
    if (message.deletable) setTimeout(() => message.delete().catch(() => {}), 3000);
    return;
  }

  // --- NEW: User History Command ---
  if (command === "history") {
    const history = loadHistory();
    const userId = message.author.id;
    const userHistory = history.users[userId] || [];

    let historyText;
    if (userHistory.length) {
      historyText = userHistory.slice(-25).map(x =>
        `${x.found ? "✅" : "❌"} \`${x.query}\` ${x.found ? `(${x.tagName})` : "(not found)"}`
      ).join("\n");
    } else {
      historyText = "No search history found for you.";
    }
    const embed = new EmbedBuilder()
      .setTitle(`Your Search History`)
      .setDescription(historyText)
      .setColor(0xEABFB9)
      .setFooter({ text: "Most recent 25 searches" });
    await message.channel.send({ content: `<@${userId}>`, embeds: [embed] });
    return;
  }

  // --- NEW: Global History Command ---
  if (
    command === "!globalhistory" || command === "!gh" ||
    command === "gh" || command === "globalhistory"
  ) {
    const history = loadHistory();
    const global = history.global || {};
    // Frequency map: tag -> { count, firstUser, users }
    const items = Object.entries(global);
    if (!items.length) {
      await message.channel.send({ embeds: [
        buildEmbed("Global Search History", "No global search records yet.", 0xEABFB9)
      ] });
      return;
    }

    // Sort by count desc
    items.sort((a, b) => b[1].count - a[1].count);

    let desc = items.map(([tag, info], i) => {
      let ulist = "";
      if (info.users.length > 3) {
        ulist = `(${info.users.length}+)`;
      } else {
        ulist = info.users.map(uid => `<@${uid}>`).join(", ");
      }
      return `**${i+1}.** \`${tag}\` - Searched ${info.count} times ${ulist}`;
    }).join("\n");

    const embed = new EmbedBuilder()
      .setTitle("Global Search History")
      .setDescription(desc.slice(0, 4096))
      .setColor(0xEABFB9)
      .setFooter({ text: "Most searched tags by users" });
    await message.channel.send({ embeds: [embed] });
    return;
  }

  // --- ADD TAG (Text Command, role-restricted) ---
  if (command === "addtag" || command === "at") {
    const member = message.member;
    if (!member || !member.roles.cache.has(ALLOWED_ROLE_ID)) {
      await message.channel.send({
        embeds: [
          buildEmbed(
            "❌ Permission Denied",
            "You do not have permission to use this command.",
            0xff0000
          ),
        ],
      });
      return;
    }

    const addTagRaw = message.content
      .slice(message.content.indexOf(command) + command.length)
      .trim();
    const split = addTagRaw.split(",");
    if (split.length < 2) {
      await message.channel.send({
        embeds: [
          buildEmbed(
            "❌ Add Tag Failed",
            "Invalid format. Use: `@Bot addtag name, url` or `@Bot at name, url`",
            0xff0000
          ),
        ],
      });
      return;
    }
    const name = `> Tags: ${split[0].trim()}`;
    let link = split.slice(1).join(",").trim();
    if (/^[\w\d]{6,}/.test(link) && !/^https?:\/\//i.test(link)) {
      link = "https://discord.gg/" + link;
    }
    if (!name || !link) {
      await message.channel.send({
        embeds: [
          buildEmbed(
            "❌ Add Tag Failed",
            "Both tag name and URL must be provided.",
            0xff0000
          ),
        ],
      });
      return;
    }
    const tags = loadTags();
    tags.push({ name, link });
    if (saveTags(tags)) {
      if (message.deletable) {
        setTimeout(() => message.delete().catch(() => {}), 100);
      }
      const confirmMsg = await message.channel.send({
        embeds: [
          buildEmbed(
            "✅ Tag Added",
            `Tag **${name}** added successfully!`,
            0x32cd32
          ),
        ],
      });
      setTimeout(() => confirmMsg.delete().catch(() => {}), 5000);
    } else {
      await message.channel.send({
        embeds: [
          buildEmbed(
            "❌ Add Tag Failed",
            "Failed to save the tag. Try again later.",
            0xff0000
          ),
        ],
      });
    }
    return;
  }

  // --- DELETE TAG (DT, [Link]) ---
  if (command === "dt") {
    const member = message.member;
    if (!member || !member.roles.cache.has(ALLOWED_ROLE_ID)) {
      await message.channel.send({
        embeds: [
          buildEmbed(
            "❌ Permission Denied",
            "You do not have permission to use this command.",
            0xff0000
          ),
        ],
      });
      return;
    }
    const linkToDelete = args.slice(2).join(" ").trim();
    if (!linkToDelete) {
      await message.channel.send({
        embeds: [
          buildEmbed(
            "❌ Delete Tag Failed",
            "You must provide the link of the tag to delete. Example: `@Bot DT, https://discord.gg/yourlink`",
            0xff0000
          ),
        ],
      });
      return;
    }
    const tags = loadTags();
    const tagIndex = tags.findIndex(t => t.link === linkToDelete);
    if (tagIndex === -1) {
      await message.channel.send({
        embeds: [
          buildEmbed(
            "❌ Delete Tag Failed",
            "No tag found with that link.",
            0xff0000
          ),
        ],
      });
      return;
    }
    const tag = tags[tagIndex];

    const confirmRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("confirm_delete_tag")
        .setLabel("Yes, Delete")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId("cancel_delete_tag")
        .setLabel("No, Cancel")
        .setStyle(ButtonStyle.Secondary)
    );
    const confirmMsg = await message.channel.send({
      embeds: [
        buildEmbed(
          "Delete Tag Confirmation",
          `Are you sure you want to delete the tag:\n**${tag.name}**\n${tag.link}`,
          0xffa500
        )
      ],
      components: [confirmRow]
    });

    const filter = (i) => i.user.id === message.author.id;
    const collector = confirmMsg.createMessageComponentCollector({ filter, max: 1, time: 30000 });

    collector.on("collect", async (interaction) => {
      if (interaction.customId === "confirm_delete_tag") {
        tags.splice(tagIndex, 1);
        saveTags(tags);
        if (message.deletable) setTimeout(() => message.delete().catch(() => {}), 100);
        await interaction.update({
          embeds: [
            buildEmbed(
              "✅ Tag Deleted",
              `Tag **${tag.name}** deleted successfully!`,
              0x32cd32
            )
          ],
          components: []
        });
      } else {
        await interaction.update({
          embeds: [
            buildEmbed(
              "Cancelled",
              "Delete tag action cancelled.",
              0xffa500
            )
          ],
          components: []
        });
      }
    });
    return;
  }

  // --- REPLACE LINK (RL, [Old Link] [New Link]) ---
  if (command === "rl") {
    const member = message.member;
    if (!member || !member.roles.cache.has(ALLOWED_ROLE_ID)) {
      await message.channel.send({
        embeds: [
          buildEmbed(
            "❌ Permission Denied",
            "You do not have permission to use this command.",
            0xff0000
          ),
        ],
      });
      return;
    }
    const rlRaw = message.content.match(/RL,\s*([^\s]+)\s+([^\s]+)/i);
    if (!rlRaw) {
      await message.channel.send({
        embeds: [
          buildEmbed(
            "❌ Replace Link Failed",
            "Invalid format! Use: `@Bot RL, oldLink newLink`",
            0xff0000
          ),
        ],
      });
      return;
    }
    let [, oldLink, newLink] = rlRaw;
    if (!oldLink || !newLink) {
      await message.channel.send({
        embeds: [
          buildEmbed(
            "❌ Replace Link Failed",
            "You must provide both old link and new link. Example: `@Bot RL, oldLink newLink`",
            0xff0000
          ),
        ],
      });
      return;
    }
    const tags = loadTags();
    const tagIndex = tags.findIndex(t => t.link === oldLink);
    if (tagIndex === -1) {
      await message.channel.send({
        embeds: [
          buildEmbed(
            "❌ Replace Link Failed",
            "No tag found with that old link.",
            0xff0000
          ),
        ],
      });
      return;
    }

    const tag = tags[tagIndex];
    const confirmRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("confirm_replace_link")
        .setLabel("Yes, Replace")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId("cancel_replace_link")
        .setLabel("No, Cancel")
        .setStyle(ButtonStyle.Secondary)
    );
    const confirmMsg = await message.channel.send({
      embeds: [
        buildEmbed(
          "Replace Link Confirmation",
          `Are you sure you want to update the link for:\n**${tag.name}**\nFrom: ${tag.link}\nTo: ${newLink}`,
          0xffa500
        )
      ],
      components: [confirmRow]
    });

    const filter = (i) => i.user.id === message.author.id;
    const collector = confirmMsg.createMessageComponentCollector({ filter, max: 1, time: 30000 });

    collector.on("collect", async (interaction) => {
      if (interaction.customId === "confirm_replace_link") {
        tags[tagIndex].link = newLink;
        saveTags(tags);
        if (message.deletable) setTimeout(() => message.delete().catch(() => {}), 100);
        await interaction.update({
          embeds: [
            buildEmbed(
              "✅ Link Replaced",
              `Link for tag **${tag.name}** updated successfully!`,
              0x32cd32
            )
          ],
          components: []
        });
      } else {
        await interaction.update({
          embeds: [
            buildEmbed(
              "Cancelled",
              "Replace link action cancelled.",
              0xffa500
            )
          ],
          components: []
        });
      }
    });
    return;
  }

  // --- Unicode Search Section (Show Chinese/Korean/Japanese) ---
  if (command === "show" && ["chinese", "korean", "japanese"].includes(language)) {
    const allTags = loadTags();
    const langTags = allTags.filter(tag => {
      if (tag.language) return tag.language.toLowerCase() === language;
      if (language === "chinese") return /[\u4e00-\u9fff]/.test(tag.name);
      if (language === "korean") return /[\uac00-\ud7af]/.test(tag.name);
      if (language === "japanese") return /[\u3040-\u30ff\u31f0-\u31ff]/.test(tag.name);
      return false;
    });

    if (langTags.length === 0) {  
      const noResultEmbed = buildEmbed(  
        `🔴 No ${language.charAt(0).toUpperCase() + language.slice(1)} Tags Found`,  
        `Sorry, no tags found for ${language}.`,  
        0xff0000  
      );  
      await message.channel.send({ embeds: [noResultEmbed] });  
      return;  
    }  

    const pageSize = 5;
    let page = 0;
    const totalPages = Math.ceil(langTags.length / pageSize);

    async function buildTagList(page) {
      const chunk = langTags.slice(page * pageSize, page * pageSize + pageSize);
      return chunk.map(t => `${t.name}\n${t.link}`).join("\n\n");
    }

    const loadingEmbed = buildEmbed(
      `<a:loading:1373152608759582771> Loading...`,
      `Fetching tags..`,
      0x32cd32 // PATCH: always green
    );
    const sent = await message.channel.send({ embeds: [loadingEmbed] });

    setTimeout(async () => {
      const initialDesc = await buildTagList(page);
      const embed = buildEmbed(
        `✅ Showing ${language.charAt(0).toUpperCase() + language.slice(1)} Tags (Page ${page + 1}/${totalPages})`,
        initialDesc,
        0x32cd32 // PATCH: always green
      );

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("unicode_prev")
          .setLabel("⬅️")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId("unicode_next")
          .setLabel("➡️")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(totalPages <= 1)
      );
      await sent.edit({ embeds: [embed], components: [row] });

      const filter = (interaction) =>
        (interaction.customId === "unicode_prev" || interaction.customId === "unicode_next") &&
        interaction.message.id === sent.id &&
        interaction.user.id === message.author.id;

      const collector = sent.createMessageComponentCollector({ filter, time: 180000 });

      collector.on("collect", async (interaction) => {
        if (interaction.customId === "unicode_prev" && page > 0) {
          page--;
        } else if (interaction.customId === "unicode_next" && page < totalPages - 1) {
          page++;
        }
        const desc = await buildTagList(page);
        const embedUpdated = buildEmbed(
          `✅ Showing ${language.charAt(0).toUpperCase() + language.slice(1)} Tags (Page ${page + 1}/${totalPages})`,
          desc,
          0x32cd32 // PATCH: always green
        );
        const rowUpdated = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("unicode_prev")
            .setLabel("⬅️")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page === 0),
          new ButtonBuilder()
            .setCustomId("unicode_next")
            .setLabel("➡️")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page >= totalPages - 1)
        );
        await interaction.update({ embeds: [embedUpdated], components: [rowUpdated] });
      });

    }, 2000);

    return;
  }

  // --- UPDATED: SYMBOLS SHOWCASE SECTION ---
  if (command === "show" && language === "symbols") {
    // Pull symbols from DBTag and Fonted.json, dedup, sort by usage/popularity (fallback: alphabetically)
    let dbTags = loadTags();
    let fontedTags = loadFontedTags();
    let symbolTags = dbTags.concat(fontedTags).filter(tag =>
      SYMBOLS.some(sym => (tag.name && tag.name.includes(sym)) || (tag.keyword && tag.keyword.includes(sym)))
    );

    // Add common face symbols (expand as needed)
    const symbolFaces = [
      ">_<", "0_0", "^_^", "^-^", "^w^", "UwU", "OwO", "oWo", ":3", ":p", ":P", "<3"
    ];

    // Deduplicate on the symbols/faces themselves for button row
    let uniqueFaces = [...new Set(symbolTags.map(tag =>
      symbolFaces.find(face => (tag.name && tag.name.includes(face)) || (tag.keyword && tag.keyword.includes(face)))
    ).filter(Boolean))];

    // Add faces not in tags also
    uniqueFaces = [...new Set(uniqueFaces.concat(symbolFaces))];

    if (!symbolTags.length) {
      await message.channel.send({
        embeds: [buildEmbed("No Symbols Found", "No tags found for symbols.", 0xff0000)]
      });
      return;
    }
    let page = 0;
    const pageSize = 6;
    const totalPages = Math.ceil(symbolTags.length / pageSize);

    function buildTagList(page) {
      const chunk = symbolTags.slice(page * pageSize, (page + 1) * pageSize);
      return chunk.map(t => `${t.name}\n${t.link}`).join("\n\n");
    }

    const embed = buildEmbed(
      "Symbols Tags",
      buildTagList(page),
      0xFFD700
    );
    // Create a row of buttons for most common symbols/faces
    const row = new ActionRowBuilder();
    uniqueFaces.slice(0, 5).forEach(face => {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`symbol_face_${face}`)
          .setLabel(face)
          .setStyle(ButtonStyle.Secondary)
      );
    });
    if (uniqueFaces.length > 5) {
      row.addComponents(
        new ButtonBuilder().setCustomId("symbol_face_more").setLabel("More...").setStyle(ButtonStyle.Primary)
      );
    }

    // Pagination buttons
    const pagingRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("symbols_prev")
        .setLabel("⬅️")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true),
      new ButtonBuilder()
        .setCustomId("symbols_next")
        .setLabel("➡️")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(totalPages <= 1)
    );
    const sent = await message.channel.send({
      content: `<@${message.author.id}>`,
      embeds: [embed],
      components: [row, pagingRow]
    });

    // Button collector
    const filter = (interaction) =>
      (interaction.customId.startsWith("symbol_face_") ||
        interaction.customId === "symbols_prev" ||
        interaction.customId === "symbols_next") &&
      interaction.message.id === sent.id &&
      interaction.user.id === message.author.id;
    const collector = sent.createMessageComponentCollector({ filter, time: 180000 });
    collector.on("collect", async (interaction) => {
      if (interaction.customId === "symbols_prev" && page > 0) {
        page--;
      } else if (interaction.customId === "symbols_next" && page < totalPages - 1) {
        page++;
      } else if (interaction.customId.startsWith("symbol_face_")) {
        let face = interaction.customId.replace("symbol_face_", "");
        let filtered = symbolTags.filter(tag =>
          (tag.name && tag.name.includes(face)) || (tag.keyword && tag.keyword.includes(face))
        );
        if (filtered.length) {
          await interaction.update({
            embeds: [buildEmbed(`Results for ${face}`, filtered.map(t => `${t.name}\n${t.link}`).join("\n\n"), 0xFFD700)],
            components: [row, pagingRow]
          });
          return;
        } else {
          await interaction.reply({ content: `No tags found for ${face}`, ephemeral: true });
          return;
        }
      }
      // Otherwise, update page
      await interaction.update({
        embeds: [buildEmbed("Symbols Tags", buildTagList(page), 0xFFD700)],
        components: [row, new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("symbols_prev")
            .setLabel("⬅️")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page === 0),
          new ButtonBuilder()
            .setCustomId("symbols_next")
            .setLabel("➡️")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page >= totalPages - 1)
        )]
      });
    });
    return;
  }

  // --- Normalized Multi-Variant Tag Search Section ---
  if (["dt", "rl"].includes(command)) return;

  // --- NEW: First-time notice before search ---
  if (!firstTimeSearchMap.has(message.author.id)) {
    const firstEmbed = new EmbedBuilder()
      .setTitle("Before you search")
      .setDescription(
        "**Note:**\n" +
        "- Tags are 4 letters (max 5 w/ ligatures)\n" +
        "- Try common or famous keywords\n" +
        "- Most Tags are only english, but there are few other languages"
      )
      .setColor(0xEABFB9)
      .setFooter({ text: "type !help for commands" });
    await message.reply({ embeds: [firstEmbed] });
    firstTimeSearchMap.add(message.author.id);
  }

  const tagQuery = args.slice(1).join(' ').trim();
  if (!tagQuery) return;

  // --- Emoji Search: If query is/has emoji, search tags with emoji in name/keyword ---
  function isEmoji(str) {
    // crude: look for surrogate pairs or common emoji ranges
    return /([\u231A-\u27BF]|[\uD83C-\uDBFF\uDC00-\uDFFF])/.test(str);
  }

  // PATCH: Fuzzy search animation and mention user
  let loadingEmbed = buildEmbed(
    `<a:loading:1373152608759582771> Starting`,
    `Searching for tag: \`${tagQuery}\``,
    0x808080
  );
  const sent = await message.channel.send({ embeds: [loadingEmbed] });

  // --- NEW: History Tracking ---
  function addSearchHistory(userId, query, found, tagName = null) {
    let history = loadHistory();
    if (!history.users[userId]) history.users[userId] = [];
    history.users[userId].push({ query, found, tagName, ts: Date.now() });
    // Only keep last 100 per user
    if (history.users[userId].length > 100) history.users[userId] = history.users[userId].slice(-100);

    // Global
    if (!history.global[query]) history.global[query] = { count: 0, users: [] };
    history.global[query].count++;
    if (!history.global[query].users.includes(userId)) history.global[query].users.push(userId);
    saveHistory(history);
  }

  let results;
  try {
    const allTags = loadTags();
    const fontedTags = loadFontedTags();

    let combinedResults = [];
    let keywordResults = [];
    let normResults = [];

    // --- Emoji search ---
    if (isEmoji(tagQuery)) {
      // Search for tags containing emoji in name or keyword
      keywordResults = fontedTags.filter(t =>
        (t.keyword && t.keyword.includes(tagQuery)) || (t.name && t.name.includes(tagQuery))
      );
      normResults = allTags.filter(t =>
        (t.name && t.name.includes(tagQuery))
      );
      combinedResults = [...keywordResults, ...normResults];
      if (!combinedResults.length) {
        // fallback: search for tags with just the emoji (if query is text+emoji)
        let emojiMatch = tagQuery.match(/([\u231A-\u27BF]|[\uD83C-\uDBFF\uDC00-\uDFFF])/);
        if (emojiMatch) {
          keywordResults = fontedTags.filter(t =>
            (t.keyword && t.keyword.includes(emojiMatch[0])) || (t.name && t.name.includes(emojiMatch[0]))
          );
          normResults = allTags.filter(t =>
            (t.name && t.name.includes(emojiMatch[0]))
          );
          combinedResults = [...keywordResults, ...normResults];
        }
      }
    } else {
      keywordResults = searchFontedTagsByKeyword(tagQuery, fontedTags);
      normResults = searchTagsNormalized(tagQuery, allTags);
      combinedResults = [...keywordResults, ...normResults];
    }

    // Prioritize Fonted.json, then DBTag.json
    if (combinedResults.length > 0) {
      let page = 0;
      const pageSize = 5;
      const totalPages = Math.ceil(combinedResults.length / pageSize);

      function buildPagedDescription(results, page, pageSize) {
        const chunk = results.slice(page * pageSize, (page + 1) * pageSize);
        let desc = "";
        if (keywordResults.length > 0 && page * pageSize < keywordResults.length) {
          const fontedChunk = chunk.filter(t => keywordResults.includes(t));
          if (fontedChunk.length > 0) {
            desc += `**Results from Fonted.json:**\n`;
            desc += fontedChunk.map(t => `**${t.name}**\n${t.link}`).join('\n\n');
          }
        }
        if (normResults.length > 0) {
          const dbChunk = chunk.filter(t => normResults.includes(t));
          if (dbChunk.length > 0) {
            if (desc) desc += '\n\n';
            desc += `**Results from DBTag.json:**\n`;
            desc += dbChunk.map(t => `**${t.name}**\n${t.link}`).join('\n\n');
          }
        }
        return desc;
      }

      let desc = buildPagedDescription(combinedResults, page, pageSize);
      const embed = buildEmbed(
        `Found ${combinedResults.length} tag(s) for "${tagQuery}" (Page ${page + 1}/${totalPages})`,
        desc,
        0x32cd32
      );
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("search_prev")
          .setLabel("⬅️")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId("search_next")
          .setLabel("➡️")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(totalPages <= 1)
      );
      await sent.edit({ content: `<@${message.author.id}>`, embeds: [embed], components: [row] });

      const filter = (interaction) =>
        (interaction.customId === "search_prev" || interaction.customId === "search_next") &&
        interaction.message.id === sent.id &&
        interaction.user.id === message.author.id;

      const collector = sent.createMessageComponentCollector({ filter, time: 180000 });

      collector.on("collect", async (interaction) => {
        if (interaction.customId === "search_prev" && page > 0) {
          page--;
        } else if (interaction.customId === "search_next" && page < totalPages - 1) {
          page++;
        }
        desc = buildPagedDescription(combinedResults, page, pageSize);
        const embedUpdated = buildEmbed(
          `Found ${combinedResults.length} tag(s) for "${tagQuery}" (Page ${page + 1}/${totalPages})`,
          desc,
          0x32cd32
        );
        const rowUpdated = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("search_prev")
            .setLabel("⬅️")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page === 0),
          new ButtonBuilder()
            .setCustomId("search_next")
            .setLabel("➡️")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page >= totalPages - 1)
        );
        await interaction.update({ embeds: [embedUpdated], components: [rowUpdated] });
      });

      // Add to search history for each result found
      addSearchHistory(message.author.id, tagQuery, true, combinedResults[0].name);

      return;
    }
  } catch (e) {}

  // Fuzzy search fallback (NO ANIMATION, just results)
  try {
    const allTags = loadTags();
    results = searchTagsFuzzy(tagQuery, allTags);

    if (results.length > 0) {
      let page = 0;
      const pageSize = 3;
      const totalPages = Math.ceil(results.length / pageSize);
      let desc = buildTagDescription(results.slice(page * pageSize, (page + 1) * pageSize));
      let embed = buildEmbed(`✅ Found ${results.length} Tags (Page ${page + 1}/${totalPages})`, desc, 0x32cd32);

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("fuzzy_prev")
          .setLabel("⬅️")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId("fuzzy_next")
          .setLabel("➡️")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(totalPages <= 1)
      );

      await sent.edit({ content: `<@${message.author.id}>`, embeds: [embed], components: [row] });

      const filter = (interaction) =>
        (interaction.customId === "fuzzy_prev" || interaction.customId === "fuzzy_next") &&
        interaction.message.id === sent.id &&
        interaction.user.id === message.author.id;

      const collector = sent.createMessageComponentCollector({ filter, time: 180000 });

      collector.on("collect", async (interaction) => {
        if (interaction.customId === "fuzzy_prev" && page > 0) {
          page--;
        } else if (interaction.customId === "fuzzy_next" && page < totalPages - 1) {
          page++;
        }
        desc = buildTagDescription(results.slice(page * pageSize, (page + 1) * pageSize));
        embed = buildEmbed(`✅ Found ${results.length} Tags (Page ${page + 1}/${totalPages})`, desc, 0x32cd32);
        const rowUpdated = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("fuzzy_prev")
            .setLabel("⬅️")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page === 0),
          new ButtonBuilder()
            .setCustomId("fuzzy_next")
            .setLabel("➡️")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page >= totalPages - 1)
        );
        await interaction.update({ embeds: [embed], components: [rowUpdated] });
      });

      // Add to search history for each result found
      addSearchHistory(message.author.id, tagQuery, true, results[0].name);

    } else {
      let noResultMsg = "";
      if (tagQuery.length > 4) {
        noResultMsg = "No Match Found, Try 4 Letters";
      } else {
        noResultMsg = "No Match Found, Be More Specific";
      }
      const noResultEmbed = buildEmbed(
        `🔴 No Results`,
        noResultMsg,
        0xff0000
      );
      await sent.edit({ content: `<@${message.author.id}>`, embeds: [noResultEmbed], components: [] });

      if (tagShouldBeLogged(tagQuery)) {
        const notFound = loadNotFoundTags();
        notFound[tagQuery] = (notFound[tagQuery] || 0) + 1;
        saveNotFoundTags(notFound);
        const channel = await client.channels.fetch(LOGGING_CHANNEL_ID);
        await updateNotFoundEmbed(channel);
      }
      // Add to search history, not found
      addSearchHistory(message.author.id, tagQuery, false, null);

      // --- NEW: Delete failure message and user's original message after 60s
      setTimeout(async () => {
        try { await sent.delete(); } catch {}
        try { if (message.deletable) await message.delete(); } catch {}
      }, 60000);
    }
  } catch {
    const noResultEmbed = buildEmbed(
      "🔴 No Results",
      "No Match Found",
      0xff0000
    );
    await sent.edit({ embeds: [noResultEmbed], components: [] });
    // Add to search history, not found
    addSearchHistory(message.author.id, tagQuery, false, null);
    setTimeout(async () => {
      try { await sent.delete(); } catch {}
      try { if (message.deletable) await message.delete(); } catch {}
    }, 60000);
  }
});

client.login(TOKEN);