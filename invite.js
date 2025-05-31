const axios = require('axios');

async function checkInvite(inviteUrl) {
  let code = inviteUrl
    .replace(/^https?:\/\/(www\.)?discord\.gg\//, '')
    .replace(/^https?:\/\/(www\.)?discord\.com\/invite\//, '')
    .split('/')[0];

  const apiUrl = `https://discord.com/api/v9/invites/${code}?with_counts=true&with_expiration=true`;

  try {
    const res = await axios.get(apiUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; DiscordBot/1.0)',
      },
    });
    const data = res.data;
    if (data && data.guild) {
      return { valid: true, data };
    } else {
      return { valid: false, data };
    }
  } catch (e) {
    return { valid: false, data: null };
  }
}

module.exports = { checkInvite };