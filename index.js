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
const { spawn } = require("child_process"); // PATCH: Added for emoji fetch

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

// --- !help Command Handler ---
client.on("messageCreate", async (message) => {
  if (
    message.author.bot ||
    typeof message.content !== "string" ||
    message.content.trim().toLowerCase() !== "!help"
  ) return;

  if (message.deletable) {
    try { await message.delete(); } catch (e) {}
  }

  const helpEmbed = new EmbedBuilder()
    .setTitle("**Commands**")
    .setDescription(
      `@Bot addtag\nor \n@Bot at\n\n` +
      `**Use:** @Bot addtag name, url\n` +
      `**Who:** Only users with BACKEND ACCESS role\n` +
      `**What:** Adds a tag to the database\n\n` +
      `@Bot DT, [Link]\n` +
      `**Use:** @Bot DT, link\n` +
      `**Who:** Only users with BACKEND ACCESS role\n` +
      `**What:** Delete tag by link, asks for confirmation\n\n` +
      `@Bot RL, [Old Link] [New Link]\n` +
      `**Use:** @Bot RL, oldLink newLink\n` +
      `**Who:** Only users with BACKEND ACCESS role\n` +
      `**What:** Replace tag's link, asks for confirmation\n\n` +
      `@Bot Show Japanese/Chinese/Korean\n\n` +
      `**Use:** @Bot show chinese/korean/japanese\n` +
      `**Who:** Anyone\n` +
      `**What:** Shows tags with Chinese, Korean, or Japanese text\n\n` +
      `@Bot show symbols\n\n` +
      `**Use:** @Bot show symbols\n` +
      `**Who:** Anyone\n` +
      `**What:** Shows tags that include symbols like <3 or :3\n\n` +
      `!Help\n` +
      `**Use:** !Help\n` +
      `**Who:** Anyone\n` +
      `**What:** shows commands of bot and what they do`
    )
    .setColor(0x2B90D9)
    .setFooter({ text: 'This message will be deleted in 60 seconds.' });

  const sentMsg = await message.channel.send({ embeds: [helpEmbed] });

  setTimeout(async () => {
    try { await sentMsg.delete(); } catch (e) {}
  }, 60000);
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

// --- !alltags command (available to everyone)
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (message.content.trim().toLowerCase() === "!alltags") {
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

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (!message.mentions.has(client.user)) return;

  const args = message.content.trim().split(/\s+/);
  const command = args[1]?.toLowerCase() || "";
  const language = args[2]?.toLowerCase() || "";

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

  // --- SYMBOLS SHOWCASE SECTION ---
  if (command === "show" && language === "symbols") {
    // ... unchanged ...
    // [Keep your original code here]
  }

  // --- Normalized Multi-Variant Tag Search Section ---
  if (["dt", "rl"].includes(command)) return;

  const tagQuery = args.slice(1).join(' ').trim();
  if (!tagQuery) return;

  // PATCH: Fuzzy search animation and mention user
  let loadingEmbed = buildEmbed(
    `<a:loading:1373152608759582771> Starting`,
    `Searching for tag: \`${tagQuery}\``,
    0x808080
  );
  const sent = await message.channel.send({ embeds: [loadingEmbed] });

  let results;
  try {
    const allTags = loadTags();
    const fontedTags = loadFontedTags();

    const keywordResults = searchFontedTagsByKeyword(tagQuery, fontedTags);
    const normResults = searchTagsNormalized(tagQuery, allTags);

    // Prioritize Fonted.json, then DBTag.json
    const combinedResults = [...keywordResults, ...normResults];

    // --- PATCHED PAGINATION+SYMBOLS FETCH SECTION ---
    if (combinedResults.length > 0) {
      let page = 0;
      const pageSize = 5;
      const totalPages = Math.ceil(combinedResults.length / pageSize);

      // Animate embed color between yellow (0xffd700) and black (0x000000)
      const ANIMATION_COLORS = [0xffd700, 0x000000];

      // Utility for delay
      function sleep(ms) { return new Promise(res => setTimeout(res, ms)); }

      // Call fetch.js for link, expect emoji string in stdout, else error emoji
      function fetchEmojiForLink(link) {
        return new Promise(res => {
          let output = "";
          const child = spawn("node", ["fetch.js", link]);
          child.stdout.on("data", chunk => output += chunk.toString());
          child.on("close", () => {
            output = output.trim();
            if (output.startsWith("<:") || output.startsWith("<a:")) {
              res(output);
            } else {
              res("<:CircleWarn:1373243873362706443>");
            }
          });
          child.on("error", () => res("<:CircleWarn:1373243873362706443>"));
        });
      }

      // Helper to build embed description with emojiList
      function buildPagedDescriptionWithEmojis(results, page, pageSize, emojiList) {
        const chunk = results.slice(page * pageSize, (page + 1) * pageSize);
        let desc = "";

        // Fonted.json section
        if (keywordResults.length > 0 && page * pageSize < keywordResults.length) {
          const fontedChunk = chunk.filter(t => keywordResults.includes(t));
          if (fontedChunk.length > 0) {
            desc += `**Results from Fonted.json:**\n`;
            fontedChunk.forEach((t, i) => {
              const idx = chunk.indexOf(t);
              const emoji = idx >= 0 && emojiList[idx] ? emojiList[idx] : "<a:loading:1373152608759582771>";
              desc += `**> ${emoji} Tag: \`${t.name.replace(/^> Tags: /, "")}\`**\n${t.link}\n\n`;
            });
          }
        }
        // DBTag.json section
        if (normResults.length > 0) {
          const dbChunk = chunk.filter(t => normResults.includes(t));
          if (dbChunk.length > 0) {
            if (desc) desc += '\n';
            desc += `**Results from DBTag.json:**\n`;
            dbChunk.forEach((t, i) => {
              const idx = chunk.indexOf(t);
              const emoji = idx >= 0 && emojiList[idx] ? emojiList[idx] : "<a:loading:1373152608759582771>";
              desc += `**> ${emoji} Tag: \`${t.name.replace(/^> Tags: /, "")}\`**\n${t.link}\n\n`;
            });
          }
        }
        return desc.trim();
      }

      // Helper to update embed with footer/color
      async function updateEmbed(sent, results, page, pageSize, emojiList, color, footerText) {
        const desc = buildPagedDescriptionWithEmojis(results, page, pageSize, emojiList);
        const embed = buildEmbed(
          `Found ${combinedResults.length} tag(s) for "${tagQuery}" (Page ${page + 1}/${totalPages})`,
          desc,
          color
        );
        if (footerText) embed.setFooter({ text: footerText });
        await sent.edit({ content: `<@${message.author.id}>`, embeds: [embed] });
      }

      // Main symbols fetch+pagination logic
      async function runPage(page) {
        let emojiList = Array(Math.min(pageSize, combinedResults.length - page * pageSize)).fill("<a:loading:1373152608759582771>");
        let animColorIdx = 0;
        let animating = true;
        let footerText = "Fetching symbols...";

        // 1. Initial embed with loading emojis, yellow color
        await updateEmbed(sent, combinedResults, page, pageSize, emojiList, ANIMATION_COLORS[animColorIdx], footerText);

        // 2. Animate color while fetching
        const animInterval = setInterval(() => {
          if (!animating) return;
          animColorIdx ^= 1;
          updateEmbed(sent, combinedResults, page, pageSize, emojiList, ANIMATION_COLORS[animColorIdx], footerText);
        }, 700);

        // 3. Fetch emojis for each link, update as soon as each is ready, with retry+delay
        const chunk = combinedResults.slice(page * pageSize, (page + 1) * pageSize);
        let uploadedEmojis = []; // for later deletion
        for (let i = 0; i < chunk.length; ++i) {
          let tries = 0, emoji = "<:CircleWarn:1373243873362706443>";
          while (tries < 3) {
            emoji = await fetchEmojiForLink(chunk[i].link);
            if (emoji !== "<:CircleWarn:1373243873362706443>") break;
            tries++;
            await sleep(1200);
          }
          emojiList[i] = emoji;
          if (emoji.startsWith("<:") || emoji.startsWith("<a:")) {
            uploadedEmojis.push(emoji);
          }
          await updateEmbed(sent, combinedResults, page, pageSize, emojiList, ANIMATION_COLORS[animColorIdx], footerText);
          await sleep(1200);
        }

        // 4. Stop animation, turn embed green, set footer to "fetched symbols"
        animating = false;
        clearInterval(animInterval);
        footerText = "Fetched symbols";
        await updateEmbed(sent, combinedResults, page, pageSize, emojiList, 0x32cd32, footerText);

        // 5. After 5s, remove footer
        setTimeout(async () => {
          await updateEmbed(sent, combinedResults, page, pageSize, emojiList, 0x32cd32, "");
        }, 5000);

        // 6. After 60s, delete uploaded emojis from server (calls fetch.js --delete link)
        setTimeout(() => {
          chunk.forEach((result, idx) => {
            if (
              uploadedEmojis[idx] && 
              (uploadedEmojis[idx].startsWith("<:") || uploadedEmojis[idx].startsWith("<a:"))
            ) {
              spawn("node", ["fetch.js", "--delete", result.link]);
            }
          });
        }, 60000);
      }

      // Initial call
      await runPage(page);

      // Pagination controls (next/prev)
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
      await sent.edit({
        content: `<@${message.author.id}>`,
        embeds: [sent.embeds[0]],
        components: [row]
      });

      const filter = (interaction) =>
        (interaction.customId === "search_prev" || interaction.customId === "search_next") &&
        interaction.message.id === sent.id &&
        interaction.user.id === message.author.id;

      const collector = sent.createMessageComponentCollector({ filter, time: 180000 });

      collector.on("collect", async (interaction) => {
        if (interaction.customId === "search_prev" && page > 0) {
          page--;
          await runPage(page);
        } else if (interaction.customId === "search_next" && page < totalPages - 1) {
          page++;
          await runPage(page);
        }
        // Update buttons
        const newRow = new ActionRowBuilder().addComponents(
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
        await interaction.update({
          embeds: [sent.embeds[0]],
          components: [newRow]
        });
      });

      return;
    }

    // If no results found, always reply with an embed
    const notFoundEmbed = buildEmbed(
      `🔍 Tag Not Found`,
      `Sorry, no tag found for: **${tagQuery}**`,
      0xff0000
    );
    await sent.edit({ content: `<@${message.author.id}>`, embeds: [notFoundEmbed], components: [] });
  } catch (e) {
    const errorEmbed = buildEmbed(
      `❌ Error`,
      `An error occurred while searching for the tag.`,
      0xff0000
    );
    await sent.edit({ embeds: [errorEmbed] });
  }
});

// ... [unchanged code below] ...