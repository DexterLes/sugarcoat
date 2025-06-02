require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const fetch = require('node-fetch');

const botToken = process.env.BOT_TOKEN;
const selfbotToken = process.env.SELFBOT_TOKEN;

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

const TARGET_GUILD_ID = '1370326604173017221';

async function fetchTagInfo(inviteCode, selfbotToken) {
    try {
        if (inviteCode.includes('/')) {
            inviteCode = inviteCode.split('/').pop();
        }
        if (inviteCode.includes('.')) {
            inviteCode = inviteCode.split('.').pop();
        }

        const headers = {
            'Accept': '*/*',
            'Accept-Language': 'en-US,en;q=0.9',
            'Authorization': selfbotToken,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'X-Super-Properties': Buffer.from(JSON.stringify({
                "os": "Windows",
                "browser": "Chrome",
                "device": "",
                "system_locale": "en-US",
                "browser_user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "browser_version": "120.0.0.0",
                "os_version": "10",
                "referrer": "",
                "referring_domain": "",
                "referrer_current": "",
                "referring_domain_current": "",
                "release_channel": "stable",
                "client_build_number": 246012,
                "client_event_source": null
            })).toString('base64')
        };

        const inviteResponse = await fetch(`https://discord.com/api/v9/invites/${inviteCode}?with_counts=true&with_expiration=true`, {
            method: 'GET',
            headers
        });

        if (!inviteResponse.ok) {
            throw new Error('Invalid invite code or failed to fetch invite');
        }

        const inviteData = await inviteResponse.json();

        const serverId = inviteData.guild.id;
        const serverTag = inviteData.profile?.tag;
        const badgeHash = inviteData.profile?.badge_hash;

        let iconUrl = null;
        if (inviteData.guild.icon) {
            iconUrl = `https://cdn.discordapp.com/icons/${serverId}/${inviteData.guild.icon}.${inviteData.guild.icon.startsWith('a_') ? 'gif' : 'png'}`;
        }

        let badgeUrl = null;
        if (badgeHash) {
            badgeUrl = `https://cdn.discordapp.com/clan-badges/${serverId}/${badgeHash}.png?size=32`;
        }

        return { serverId, serverTag, iconUrl, badgeUrl, guildName: inviteData.guild.name };
    } catch (error) {
        throw error;
    }
}

client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const prefix = '-';
    if (!message.content.startsWith(prefix)) return;

    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    if (command === 'tag') {
        const inviteLink = args[0];
        if (!inviteLink) {
            return message.reply('Please provide a Discord invite link or code.');
        }

        try {
            const { serverId, serverTag, iconUrl, badgeUrl, guildName } = await fetchTagInfo(inviteLink, selfbotToken);

            if (!iconUrl && !badgeUrl) {
                return message.reply('No server tag or badge found for this invite.');
            }

            const guild = client.guilds.cache.get(TARGET_GUILD_ID);
            if (!guild) {
                return message.reply('Target guild not found or bot is not in that guild.');
            }

            // Fetch image buffer from either iconUrl or badgeUrl
            const imageUrl = badgeUrl || iconUrl;

            const response = await fetch(imageUrl);
            if (!response.ok) {
                return message.reply('Failed to fetch image from URL.');
            }
            const imageBuffer = await response.buffer();

            // Create emoji name - sanitize serverTag or fallback
            let emojiName = 'tag_emoji1';
            if (serverTag) {
                emojiName = serverTag.toLowerCase().replace(/[^a-z0-9_]/g, '') || emojiName;
            }

            // Check if emoji with the name already exists, delete it first
            const existingEmoji = guild.emojis.cache.find(e => e.name === emojiName);
            if (existingEmoji) {
                await existingEmoji.delete('Replacing existing emoji with new tag/badge image');
            }

            const emoji = await guild.emojis.create({ attachment: imageBuffer, name: emojiName });

            message.reply(`Uploaded emoji ${emoji.name} to guild **${guildName}**!`);

        } catch (error) {
            console.error('Error processing tag command:', error);
            message.reply('Something went wrong while processing the invite.');
        }
    }
});

client.login(botToken);