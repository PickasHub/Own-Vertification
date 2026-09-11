const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder, REST, Routes, PermissionFlagsBits } = require('discord.js');
const express = require('express');
const axios = require('axios'); // Kailangan para sa API fetch ng ScriptBlox

// ================= CONFIGURATION =================
const CONFIG = {
  TOKEN: 'YOUR_BOT_TOKEN', // Replace with your Discord Bot Token
  GUILD_ID:'YOUR_GUILD_ID_HERE', // Replace With Your Server ID
  VERIFIED_ROLE_ID: 'YOUR_ROLE_ID', // Replace With Your Verify Role ID
  PORT: 9851,
  LOOTLABS_BASE_URL: 'https://lootdest.org/s?9MIGdTHy',
  YT_TUTORIAL: 'https://youtu.be/Wo61upr9RMU?si=xo_1LucVSiaeo8UU',
  TIKTOK_TUTORIAL: 'https://vt.tiktok.com/ZSq56q6eh/'
};
// =================================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildInvites
  ]
});

const app = express();
app.use(express.json());

app.get('/', (req, res) => res.send('Bot is running with Live Script Search & Verification!'));

// --- REGISTER SLASH COMMANDS ---
client.once('clientReady', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  app.listen(CONFIG.PORT, () => {
    console.log(`🌐 Server running on port: ${CONFIG.PORT}`);
  });

  const rest = new REST({ version: '10' }).setToken(CONFIG.TOKEN);
  
  const commands = [
    new SlashCommandBuilder()
      .setName('setupverify')
      .setDescription('Deploy the verification panel in this channel'),
    new SlashCommandBuilder()
      .setName('searchscript')
      .setDescription('Search scripts directly from ScriptBlox')
      .addStringOption(option => 
        option.setName('query')
              .setDescription('Name of the game or script (e.g., Blox Fruits, Steal An Egg)')
              .setRequired(true)
      ),
    new SlashCommandBuilder()
      .setName('mute')
      .setDescription('Timeout or mute a user')
      .addUserOption(option => option.setName('target').setDescription('The user to mute').setRequired(true))
      .addIntegerOption(option => option.setName('minutes').setDescription('Duration of the mute in minutes').setRequired(true))
      .addStringOption(option => option.setName('reason').setDescription('Reason for the mute').setRequired(false)),
    new SlashCommandBuilder()
      .setName('clear')
      .setDescription('Delete messages in this channel')
      .addIntegerOption(option => option.setName('amount').setDescription('Number of messages to delete (1-100)').setRequired(true)),
    new SlashCommandBuilder()
      .setName('invites')
      .setDescription('Check your invite count or another user\'s')
      .addUserOption(option => option.setName('user').setDescription('User to check invites for (optional)').setRequired(false))
  ];

  try {
    await rest.put(
      Routes.applicationGuildCommands(client.user.id, CONFIG.GUILD_ID),
      { body: commands.map(c => c.toJSON()) },
    );
    console.log('✅ Slash commands registered successfully.');
  } catch (error) {
    console.error('❌ Failed to register slash commands:', error);
  }
});

// Store active script searches for pagination
const scriptCache = new Map();

// Function to handle ScriptBlox API Search logic
async function handleScriptSearch(channelOrInteraction, query, isInteraction = false) {
  try {
    const response = await axios.get(`https://scriptblox.com/api/cheat/search?q=${encodeURIComponent(query)}&mode=server`);
    const scripts = response.data.result?.scripts;

    if (!scripts || scripts.length === 0) {
      const msg = `❌ No scripts found for "**${query}**".`;
      return isInteraction ? channelOrInteraction.reply({ content: msg, flags: 64 }) : channelOrInteraction.reply(msg);
    }

    let currentIndex = 0;

    const generateEmbed = (index) => {
      const s = scripts[index];
      const scriptCode = s.script ? `\`\`\`lua\n${s.script}\n\`\`\`` : '`No loadstring available`';
      const keyStatus = s.isKey ? 'Yes' : 'No';

      return new EmbedBuilder()
        .setColor(0x00FF00)
        .setTitle(`📜 ${s.title}`)
        .addFields(
          { name: '🎮 Game', value: s.game?.name || 'Unknown', inline: false },
          { name: '🔑 Key Needed?', value: keyStatus, inline: false },
          { name: '👁️ Views', value: s.views ? s.views.toString() : '0', inline: false },
          { name: '💻 Script Code', value: scriptCode, inline: false }
        )
        .setFooter({ text: `Page ${index + 1} of ${scripts.length} | Source: ScriptBlox` });
    };

    const generateRow = (index) => {
      return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`script_back_${index}`)
          .setLabel('◀ Back')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(index === 0),
        new ButtonBuilder()
          .setCustomId(`script_next_${index}`)
          .setLabel('Next ▶')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(index === scripts.length - 1)
      );
    };

    const replyPayload = {
      embeds: [generateEmbed(currentIndex)],
      components: [generateRow(currentIndex)]
    };

    let sentMessage;
    if (isInteraction) {
      sentMessage = await channelOrInteraction.reply(replyPayload);
    } else {
      sentMessage = await channelOrInteraction.reply(replyPayload);
    }

    // Save to cache for pagination buttons
    const messageId = isInteraction ? (await channelOrInteraction.fetchReply()).id : sentMessage.id;
    scriptCache.set(messageId, { scripts, currentIndex });

  } catch (err) {
    console.error('Script Search Error:', err);
    const errMsg = '❌ Failed to fetch scripts from ScriptBlox API. Please try again later.';
    if (isInteraction) {
      await channelOrInteraction.reply({ content: errMsg, flags: 64 });
    } else {
      await channelOrInteraction.reply(errMsg);
    }
  }
}

// --- INTERACTION HANDLER (Slash Commands & Buttons) ---
client.on('interactionCreate', async interaction => {
  try {
    // Handle Script Pagination Buttons
    if (interaction.isButton() && (interaction.customId.startsWith('script_back_') || interaction.customId.startsWith('script_next_'))) {
      const cacheData = scriptCache.get(interaction.message.id);
      if (!cacheData) {
        return interaction.reply({ content: '❌ Session expired. Please search again using `!searchscript`.', flags: 64 });
      }

      let { scripts, currentIndex } = cacheData;
      if (interaction.customId.startsWith('script_back_')) {
        currentIndex = Math.max(0, currentIndex - 1);
      } else {
        currentIndex = Math.min(scripts.length - 1, currentIndex + 1);
      }
      cacheData.currentIndex = currentIndex;

      const scriptCode = scripts[currentIndex].script ? `\`\`\`lua\n${scripts[currentIndex].script}\n\`\`\`` : '`No loadstring available`';
      const keyStatus = scripts[currentIndex].isKey ? 'Yes' : 'No';

      const updatedEmbed = new EmbedBuilder()
        .setColor(0x00FF00)
        .setTitle(`📜 ${scripts[currentIndex].title}`)
        .addFields(
          { name: '🎮 Game', value: scripts[currentIndex].game?.name || 'Unknown', inline: false },
          { name: '🔑 Key Needed?', value: keyStatus, inline: false },
          { name: '👁️ Views', value: scripts[currentIndex].views ? scripts[currentIndex].views.toString() : '0', inline: false },
          { name: '💻 Script Code', value: scriptCode, inline: false }
        )
        .setFooter({ text: `Page ${currentIndex + 1} of ${scripts.length} | Source: ScriptBlox` });

      const updatedRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`script_back_${currentIndex}`).setLabel('◀ Back').setStyle(ButtonStyle.Secondary).setDisabled(currentIndex === 0),
        new ButtonBuilder().setCustomId(`script_next_${currentIndex}`).setLabel('Next ▶').setStyle(ButtonStyle.Secondary).setDisabled(currentIndex === scripts.length - 1)
      );

      return interaction.update({ embeds: [updatedEmbed], components: [updatedRow] });
    }

    // 1. /setupverify
    if (interaction.isChatInputCommand() && interaction.commandName === 'setupverify') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: 'You do not have permission to use this.', flags: 64 });
      }

      const embed = new EmbedBuilder()
        .setTitle('🛡️ Server Verification System')
        .setDescription(`Click the button below to start your verification process.\n\nIf you don't know how to verify\n\nYouTube\n> [how to verify](${CONFIG.YT_TUTORIAL})\n\nTikTok\n> [how to verify](${CONFIG.TIKTOK_TUTORIAL})\n\nComplete The Task......`)
        .setColor(0x00FFCC);

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('get_verification_link')
          .setLabel('Verify Account')
          .setStyle(ButtonStyle.Primary)
      );

      return interaction.reply({ embeds: [embed], components: [row] });
    }

    // 2. /searchscript
    if (interaction.isChatInputCommand() && interaction.commandName === 'searchscript') {
      const query = interaction.options.getString('query');
      await handleScriptSearch(interaction, query, true);
      return;
    }

    // 3. /mute
    if (interaction.isChatInputCommand() && interaction.commandName === 'mute') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
        return interaction.reply({ content: '❌ You need `Moderate Members` permission to mute users.', flags: 64 });
      }

      const target = interaction.options.getMember('target');
      const minutes = interaction.options.getInteger('minutes');
      const reason = interaction.options.getString('reason') || 'No reason provided';

      if (!target) return interaction.reply({ content: '❌ User not found in this server.', flags: 64 });

      try {
        const ms = minutes * 60 * 1000;
        await target.timeout(ms, reason);
        return interaction.reply({ content: `✅ Successfully muted **${target.user.tag}** for **${minutes} minute(s)**. Reason: *${reason}*`, flags: 64 });
      } catch (err) {
        return interaction.reply({ content: '❌ Failed to mute this user. Their role might be higher than the bot\'s.', flags: 64 });
      }
    }

    // 4. /clear
    if (interaction.isChatInputCommand() && interaction.commandName === 'clear') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
        return interaction.reply({ content: '❌ You need `Manage Messages` permission to clear messages.', flags: 64 });
      }

      const amount = interaction.options.getInteger('amount');
      if (amount < 1 || amount > 100) {
        return interaction.reply({ content: '❌ Please specify a number between 1 and 100.', flags: 64 });
      }

      await interaction.deferReply({ flags: 64 });
      try {
        const deleted = await interaction.channel.bulkDelete(amount, true);
        return interaction.editReply({ content: `🗑️ Successfully deleted **${deleted.size}** message(s).` });
      } catch (err) {
        return interaction.editReply({ content: '❌ Failed to delete messages (Messages older than 14 days cannot be bulk deleted).' });
      }
    }

    // 5. /invites
    if (interaction.isChatInputCommand() && interaction.commandName === 'invites') {
      const targetUser = interaction.options.getUser('user') || interaction.user;
      try {
        const invites = await interaction.guild.invites.fetch();
        let userInvites = 0;
        invites.forEach(inv => {
          if (inv.inviter && inv.inviter.id === targetUser.id) {
            userInvites += inv.uses;
          }
        });

        const embed = new EmbedBuilder()
          .setTitle('📊 Invite Tracker')
          .setDescription(`**${targetUser.tag}** has a total of **${userInvites}** invite(s) in this server!`)
          .setColor(0x9B59B6);

        return interaction.reply({ embeds: [embed] });
      } catch (err) {
        return interaction.reply({ content: '❌ Could not fetch invite list. Make sure the bot has `Manage Server` permission.', flags: 64 });
      }
    }

    // --- VERIFICATION TIMER BUTTON HANDLERS ---
    if (interaction.isButton() && interaction.customId === 'get_verification_link') {
      const userId = interaction.user.id;
      const personalLink = `${CONFIG.LOOTLABS_BASE_URL}&s1=${userId}`;
      let timeLeft = 180; // 3 Minutes Timer

      const formatTime = (seconds) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
      };

      const getEmbed = (seconds) => new EmbedBuilder()
        .setTitle('⏳ Please Complete Your Task')
        .setDescription(`Hello <@${userId}>!\n\n1. Click **Open LootLabs Link** below and finish the task.\n2. **Please wait for the timer to finish.**\n\nYouTube\n> [how to verify](${CONFIG.YT_TUTORIAL})\n\nTikTok\n> [how to verify](${CONFIG.TIKTOK_TUTORIAL})\n\n⏰ **Time remaining:** \`${formatTime(seconds)}\`\n\n[Open LootLabs Link](${personalLink})`)
        .setColor(0xFFA500);

      const getRow = (disabled, secondsText) => new ActionRowBuilder().addComponents(
        new ButtonBuilder().setURL(personalLink).setLabel('Open LootLabs Link').setStyle(ButtonStyle.Link),
        new ButtonBuilder().setCustomId(`complete_verify_${userId}`).setLabel(disabled ? `⏳ Wait (${formatTime(secondsText)})` : '✅ Complete Verification').setStyle(disabled ? ButtonStyle.Secondary : ButtonStyle.Success).setDisabled(disabled)
      );

      await interaction.reply({ embeds: [getEmbed(timeLeft)], components: [getRow(true, timeLeft)], flags: 64 });

      const timerInterval = setInterval(async () => {
        timeLeft--;
        if (timeLeft > 0) {
          try {
            await interaction.editReply({ embeds: [getEmbed(timeLeft)], components: [getRow(true, timeLeft)] });
          } catch (e) {
            clearInterval(timerInterval);
          }
        } else {
          clearInterval(timerInterval);
          try {
            const finishedEmbed = new EmbedBuilder()
              .setTitle('🎉 Timer Finished!')
              .setDescription(`Hello <@${userId}>!\n\nThe 3-minute wait is over! Click **Complete Verification** below to claim your role.\n\nYouTube\n> [how to verify](${CONFIG.YT_TUTORIAL})\n\nTikTok\n> [how to verify](${CONFIG.TIKTOK_TUTORIAL})`)
              .setColor(0x00FF00);

            await interaction.editReply({ embeds: [finishedEmbed], components: [getRow(false, 0)] });
          } catch (e) {}
        }
      }, 1000);
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith('complete_verify_')) {
      await interaction.deferReply({ flags: 64 });
      const member = interaction.member;

      if (member.roles.cache.has(CONFIG.VERIFIED_ROLE_ID)) {
        return interaction.editReply({ content: '🎉 You already have the Verified role!' });
      }

      try {
        const role = interaction.guild.roles.cache.get(CONFIG.VERIFIED_ROLE_ID);
        if (!role) return interaction.editReply({ content: '❌ Error: Could not find the role on the server.' });

        await member.roles.add(role);
        return interaction.editReply({ content: '💥 **Verification successful!** The Verified role has been granted to you.' });
      } catch (error) {
        return interaction.editReply({ content: '❌ Failed to assign role. Make sure the bot\'s role is positioned ABOVE the Verified role in Server Settings -> Roles.' });
      }
    }

  } catch (error) {
    console.error('❌ Interaction Error:', error);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: 'An error occurred.', flags: 64 }).catch(() => {});
    }
  }
});

// --- TEXT COMMAND FALLBACK (!searchscript, !clear, !setupverify) ---
client.on('messageCreate', async message => {
  if (message.author.bot) return;

  // 1. !setupverify command
  if (message.content === '!setupverify') {
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) return;

    const embed = new EmbedBuilder()
      .setTitle('🛡️ Server Verification System')
      .setDescription(`Click the button below to start your verification process.\n\nIf you don't know how to verify\n\nYouTube\n> [how to verify](${CONFIG.YT_TUTORIAL})\n\nTikTok\n> [how to verify](${CONFIG.TIKTOK_TUTORIAL})\n\nComplete The Task......`)
      .setColor(0x00FFCC);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('get_verification_link')
        .setLabel('Verify Account')
        .setStyle(ButtonStyle.Primary)
    );

    await message.channel.send({ embeds: [embed], components: [row] });
    await message.delete().catch(() => {});
    return;
  }

  // 2. !searchscript [query] command
  if (message.content.startsWith('!searchscript')) {
    const args = message.content.slice('!searchscript'.length).trim();
    if (!args) {
      return message.reply('❌ Please specify a game or script name! (Example: `!searchscript steal an egg`)');
    }
    await handleScriptSearch(message, args, false);
    return;
  }

  // 3. !clear [amount] command
  if (message.content.startsWith('!clear')) {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
      return message.reply('❌ You need `Manage Messages` permission to clear messages.');
    }

    const args = message.content.split(' ');
    const amount = parseInt(args[1]);

    if (isNaN(amount) || amount < 1 || amount > 100) {
      return message.reply('❌ Please specify a valid number between 1 and 100. (Example: `!clear 10`)');
    }

    try {
      const deleted = await message.channel.bulkDelete(amount, true);
      const replyMsg = await message.channel.send(`🗑️ Successfully deleted **${deleted.size}** message(s).`);
      setTimeout(() => replyMsg.delete().catch(() => {}), 4000); // Burahin ang success notice pagkalipas ng 4 segundo
    } catch (err) {
      message.reply('❌ Failed to delete messages (Messages older than 14 days cannot be bulk deleted).');
    }
    return;
  }
});

client.login(CONFIG.TOKEN);
