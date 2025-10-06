import {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  SlashCommandBuilder
} from "discord.js";
import mongoose from "mongoose";
import dotenv from "dotenv";
import fetch from "node-fetch";
import config from "./config.json" assert { type: "json" };

dotenv.config();

// --- MongoDB Schema ---
const userSchema = new mongoose.Schema({
  robloxId: { type: String, required: true, unique: true },
  robloxUsername: { type: String, required: true },
  xp: { type: Number, default: 0 }
});
const User = mongoose.model("User", userSchema);

// --- Level system from config ---
const levels = config.levels;

// --- Level calculation ---
function getLevel(xp) {
  let level = levels[0];
  for (const l of levels) {
    if (xp >= l.xp) level = l;
    else break;
  }
  const nextLevel = levels[levels.indexOf(level) + 1] || null;

  let progressPercent = 100;
  let bar = "⬜".repeat(10);
  let xpNeededText = "🎉 Max level reached!";

  if (nextLevel) {
    const currentXP = xp - level.xp;
    const neededXP = nextLevel.xp - level.xp;
    progressPercent = Math.floor((currentXP / neededXP) * 100);

    const filled = Math.floor(progressPercent / 10);
    const empty = 10 - filled;

    bar = "⬜".repeat(filled) + "🔳".repeat(empty);
    xpNeededText = `Needs **${neededXP - currentXP} XP** to reach **${nextLevel.name}**`;
  }

  return { levelName: level.name, bar, progressPercent, xpNeededText };
}

// --- Bot Setup ---
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// --- Roblox API Helpers ---
async function getRobloxUser(username) {
  const res = await fetch(`https://users.roblox.com/v1/usernames/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ usernames: [username] })
  });
  const data = await res.json();
  if (!data.data || data.data.length === 0) return null;
  return data.data[0]; // {id, name, displayName}
}

async function getRobloxAvatar(userId) {
  const res = await fetch(
    `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=420x420&format=png`
  );
  const data = await res.json();
  if (!data.data || data.data.length === 0) return null;
  return data.data[0].imageUrl;
}

async function isInRobloxGroup(userId, groupId = config.groupId) {
  const res = await fetch(`https://groups.roblox.com/v1/users/${userId}/groups/roles`);
  const data = await res.json();
  if (!data || !data.data) return false;
  return data.data.some(g => g.group.id === groupId);
}

// --- Slash Commands Register (local, bisa deploy ke guild) ---
client.on("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  const commands = [
    new SlashCommandBuilder()
      .setName("xp")
      .setDescription("Manage user XP")
      .addSubcommand(sub =>
        sub
          .setName("add")
          .setDescription("Add XP")
          .addStringOption(opt => opt.setName("username").setDescription("Roblox username").setRequired(true))
          .addIntegerOption(opt => opt.setName("amount").setDescription("XP amount").setRequired(true))
      )
      .addSubcommand(sub =>
        sub
          .setName("remove")
          .setDescription("Remove XP")
          .addStringOption(opt => opt.setName("username").setDescription("Roblox username").setRequired(true))
          .addIntegerOption(opt => opt.setName("amount").setDescription("XP amount").setRequired(true))
      )
      .addSubcommand(sub =>
        sub
          .setName("set")
          .setDescription("Set XP")
          .addStringOption(opt => opt.setName("username").setDescription("Roblox username").setRequired(true))
          .addIntegerOption(opt => opt.setName("amount").setDescription("XP amount").setRequired(true))
      ),

    new SlashCommandBuilder()
      .setName("rank")
      .setDescription("Check rank of a Roblox user")
      .addStringOption(opt => opt.setName("username").setDescription("Roblox username").setRequired(true)),

    new SlashCommandBuilder()
      .setName("leaderboard")
      .setDescription("Show XP leaderboard")
      .addIntegerOption(opt =>
        opt.setName("page").setDescription("Page number").setRequired(false)
      )
  ];

  await client.application.commands.set(commands);
  console.log("✅ Slash commands registered");
});

// --- Interaction Handler ---
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const username = interaction.options.getString("username");

  // --- /xp ---
  if (interaction.commandName === "xp") {
    const allowed =
      interaction.member.permissions.has(PermissionFlagsBits.Administrator) ||
      interaction.member.roles.cache.some(r => config.xpManagerRoles.includes(r.id));
    if (!allowed) return interaction.reply("❌ You do not have permission to use this command.");

    const action = interaction.options.getSubcommand();
    const amount = interaction.options.getInteger("amount");

    const robloxData = await getRobloxUser(username);
    if (!robloxData) return interaction.reply("⚠️ Roblox user not found.");

    const inGroup = await isInRobloxGroup(robloxData.id, config.groupId);
    if (!inGroup) return interaction.reply("❌ User is not in the community group.");

    let user = await User.findOne({ robloxId: robloxData.id.toString() });
    if (!user) user = new User({ robloxId: robloxData.id.toString(), robloxUsername: robloxData.name, xp: 0 });

    const oldLevel = getLevel(user.xp).levelName;

    if (action === "add") user.xp += amount;
    if (action === "remove") user.xp = Math.max(user.xp - amount, 0);
    if (action === "set") user.xp = amount;

    user.robloxUsername = robloxData.name; // sync username
    await user.save();

    const newLevel = getLevel(user.xp).levelName;
    let levelMsg = "";
    if (newLevel !== oldLevel) levelMsg = ` 🎉 **${robloxData.name} has leveled up to ${newLevel}!**`;

    // --- XP Log ---
    const logChannel = interaction.guild.channels.cache.get(config.xpLogChannelId);
    if (logChannel) {
      const logEmbed = new EmbedBuilder()
        .setTitle("📊 XP Log")
        .setColor("#1B1464")
        .addFields(
          { name: "Action", value: action, inline: true },
          { name: "Amount", value: amount.toString(), inline: true },
          { name: "Target", value: `${robloxData.name} (${robloxData.id})`, inline: true },
          { name: "By", value: interaction.user.tag, inline: true },
          { name: "New XP", value: user.xp.toString(), inline: true }
        )
        .setTimestamp();
      logChannel.send({ embeds: [logEmbed] });
    }

    return interaction.reply(`✅ ${action} ${amount} XP for **${robloxData.name}**${levelMsg}`);
  }

  // --- /rank ---
  if (interaction.commandName === "rank") {
    const robloxData = await getRobloxUser(username);
    if (!robloxData) return interaction.reply("⚠️ Roblox user not found.");

    let user = await User.findOne({ robloxId: robloxData.id.toString() });
    if (!user) {
      user = new User({ robloxId: robloxData.id.toString(), robloxUsername: robloxData.name, xp: 0 });
      await user.save();
    }

    const avatar = await getRobloxAvatar(robloxData.id);
    const { levelName, bar, progressPercent, xpNeededText } = getLevel(user.xp);

    const embed = new EmbedBuilder()
      .setTitle(`${robloxData.displayName} (@${robloxData.name})`)
      .setURL(`https://www.roblox.com/users/${robloxData.id}/profile`)
      .setThumbnail(avatar)
      .addFields(
        { name: "Roblox Username", value: robloxData.name, inline: true },
        { name: "Roblox ID", value: robloxData.id.toString(), inline: true },
        { name: "XP", value: user.xp.toString(), inline: true },
        { name: "Level", value: levelName, inline: true },
        { name: "Progress", value: `${bar} (${progressPercent}%)`, inline: false },
        { name: "Next Level", value: xpNeededText, inline: false }
      )
      .setColor("#1B1464");

    await interaction.reply({ embeds: [embed] });
  }

  // --- /leaderboard ---
  if (interaction.commandName === "leaderboard") {
    const limit = 10;
    let page = interaction.options.getInteger("page") || 1;

    const generateEmbed = async (page) => {
      const totalUsers = await User.countDocuments();
      const totalPages = Math.max(1, Math.ceil(totalUsers / limit));

      if (page < 1) page = 1;
      if (page > totalPages) page = totalPages;

      const users = await User.find()
        .sort({ xp: -1 })
        .skip((page - 1) * limit)
        .limit(limit);

      let description = "";
      let rank = (page - 1) * limit + 1;
      for (const u of users) {
        description += `**#${rank}** - **${u.robloxUsername}** → ${u.xp} XP\n`;
        rank++;
      }

      return {
        embeds: [
          new EmbedBuilder()
            .setTitle(`🏆 Climbers Leaderboard (Page ${page}/${totalPages})`)
            .setColor("#1B1464")
            .setDescription(description || "⚠️ No users found.")
        ],
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId("prev")
              .setLabel("⬅️ Previous")
              .setStyle(ButtonStyle.Primary)
              .setDisabled(page === 1),
            new ButtonBuilder()
              .setCustomId("next")
              .setLabel("Next ➡️")
              .setStyle(ButtonStyle.Primary)
              .setDisabled(page === totalPages)
          )
        ]
      };
    };

    let leaderboardMessage = await interaction.reply(await generateEmbed(page));
    const collector = leaderboardMessage.createMessageComponentCollector({ time: 60000 });

    collector.on("collect", async (btnInteraction) => {
      if (!btnInteraction.isButton()) return;

      if (btnInteraction.customId === "prev") page--;
      if (btnInteraction.customId === "next") page++;

      await btnInteraction.update(await generateEmbed(page));
    });

    collector.on("end", async () => {
      const finalEmbed = await generateEmbed(page);
      finalEmbed.components[0].components.forEach(btn => btn.setDisabled(true));
      await interaction.editReply(finalEmbed);
    });
  }
});

// --- MongoDB Connect & Start Bot ---
mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log("✅ Connected to MongoDB");
    client.login(process.env.TOKEN);
  })
  .catch(console.error);
