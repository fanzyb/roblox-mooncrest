import {
    Client,
    GatewayIntentBits,
    EmbedBuilder,
    PermissionFlagsBits,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    SlashCommandBuilder,
    StringSelectMenuBuilder
} from "discord.js";
import mongoose from "mongoose";
import dotenv from "dotenv";
import fetch from "node-fetch";
import config from "./config.json" assert { type: "json" };

dotenv.config();

// ----------------- Mongo Schema -----------------
const userSchema = new mongoose.Schema({
    robloxId: { type: String, required: true, unique: true },
    robloxUsername: { type: String, required: true },
    xp: { type: Number, default: 0 },
    expeditions: { type: Number, default: 0 }, // Field untuk menyimpan jumlah ekspedisi
    achievements: { type: [Number], default: [] } // numeric achievement IDs
});
const User = mongoose.model("User", userSchema);

// ----------------- Helpers -----------------
const levels = config.levels || [];
const achievementsConfig = config.achievements || [];

function getLevel(xp) {
    if (!levels.length) return { levelName: "N/A", bar: "⬜".repeat(10), progressPercent: 0, xpNeededText: "No levels configured" };
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
        const filled = Math.max(0, Math.min(10, Math.floor(progressPercent / 10)));
        const empty = 10 - filled;
        bar = "⬜".repeat(filled) + "🔳".repeat(empty);
        xpNeededText = `Needs **${Math.max(0, neededXP - currentXP)} XP** to reach **${nextLevel.name}**`;
    }

    return { levelName: level.name, bar, progressPercent, xpNeededText };
}

async function getRobloxUser(username) {
    try {
        const res = await fetch(`https://users.roblox.com/v1/usernames/users`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ usernames: [username] })
        });
        const data = await res.json();
        if (!data.data || data.data.length === 0) return null;
        return data.data[0];
    } catch (e) {
        console.error("Roblox user fetch error:", e);
        return null;
    }
}

async function getRobloxAvatar(userId) {
    try {
        const res = await fetch(
            `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=420x420&format=png`
        );
        const data = await res.json();
        if (!data.data || data.data.length === 0) return null;
        return data.data[0].imageUrl;
    } catch (e) {
        return null;
    }
}

async function isInRobloxGroup(userId, groupId = config.groupId) {
    try {
        const res = await fetch(`https://groups.roblox.com/v1/users/${userId}/groups/roles`);
        const data = await res.json();
        if (!data || !data.data) return false;
        return data.data.some(g => g.group.id === groupId);
    } catch (e) {
        return false;
    }
}

async function getRobloxGroupMemberCount(groupId = config.groupId) {
    try {
        const res = await fetch(`https://groups.roblox.com/v1/groups/${groupId}`);
        const data = await res.json();
        if (data && typeof data.memberCount === 'number') {
            return data.memberCount;
        }
        return 0;
    } catch (e) {
        console.error("Roblox group member count fetch error:", e);
        return 0;
    }
}

// ----------------- Client -----------------
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// ----------------- Ready & Register Commands -----------------
client.on("ready", async () => {
    console.log(`✅ Logged in as ${client.user.tag}`);

    const guild = client.guilds.cache.first();
    const serverName = guild ? guild.name : "the server";

    async function updatePresence() {
        const memberCount = await getRobloxGroupMemberCount(); 

        client.user.setPresence({
            activities: [{ 
                name: `Counting ${memberCount.toLocaleString()} Members`, 
                type: 3 // Watching
            }],
            status: "online"
        });
        console.log(`Presence updated: Counting ${memberCount.toLocaleString()} Members`);
    }

    updatePresence();
    setInterval(updatePresence, 1000 * 60 * 10); // Update setiap 10 menit

    // build slash commands
    const commands = [
        // XP (admin/xpManager)
        new SlashCommandBuilder()
            .setName("xp")
            .setDescription("Manage user XP")
            .addSubcommand(sub =>
                sub.setName("add").setDescription("Add XP")
                    .addStringOption(opt => opt.setName("username").setDescription("Roblox username").setRequired(true))
                    .addIntegerOption(opt => opt.setName("amount").setDescription("XP amount").setRequired(true))
            )
            .addSubcommand(sub =>
                sub.setName("remove").setDescription("Remove XP")
                    .addStringOption(opt => opt.setName("username").setDescription("Roblox username").setRequired(true))
                    .addIntegerOption(opt => opt.setName("amount").setDescription("XP amount").setRequired(true))
            )
            .addSubcommand(sub =>
                sub.setName("set").setDescription("Set XP")
                    .addStringOption(opt => opt.setName("username").setDescription("Roblox username").setRequired(true))
                    .addIntegerOption(opt => opt.setName("amount").setDescription("XP amount").setRequired(true))
            ),

        // Expedition (admin/xpManager)
        new SlashCommandBuilder()
            .setName("expo")
            .setDescription("Manage user Expedition count")
            .addSubcommand(sub =>
                sub.setName("add").setDescription("Add expeditions count")
                    .addStringOption(opt => opt.setName("username").setDescription("Roblox username").setRequired(true))
                    .addIntegerOption(opt => opt.setName("amount").setDescription("Expedition amount").setRequired(true))
            )
            .addSubcommand(sub =>
                sub.setName("remove").setDescription("Remove expeditions count")
                    .addStringOption(opt => opt.setName("username").setDescription("Roblox username").setRequired(true))
                    .addIntegerOption(opt => opt.setName("amount").setDescription("Expedition amount").setRequired(true))
            )
            .addSubcommand(sub =>
                sub.setName("set").setDescription("Set expeditions count")
                    .addStringOption(opt => opt.setName("username").setDescription("Roblox username").setRequired(true))
                    .addIntegerOption(opt => opt.setName("amount").setDescription("Expedition amount").setRequired(true))
            ),

        // rank
        new SlashCommandBuilder()
            .setName("rank")
            .setDescription("Check rank of a Roblox user")
            .addStringOption(opt => opt.setName("username").setDescription("Roblox username").setRequired(true)),

        // leaderboard
        new SlashCommandBuilder()
            .setName("leaderboard")
            .setDescription("Show XP leaderboard")
            .addIntegerOption(opt => opt.setName("page").setDescription("Page number").setRequired(false)),

        // reward (interactive add/remove)
        new SlashCommandBuilder()
            .setName("reward")
            .setDescription("Give or remove achievements (interactive)")
            .addSubcommand(sub =>
                sub.setName("add")
                    .setDescription("Give an achievement to a user")
                    .addStringOption(opt => opt.setName("username").setDescription("Roblox username").setRequired(true))
            )
            .addSubcommand(sub =>
                sub.setName("remove")
                    .setDescription("Remove an achievement from a user")
                    .addStringOption(opt => opt.setName("username").setDescription("Roblox username").setRequired(true))
            ),

        // hall-of-fame
        new SlashCommandBuilder()
            .setName("hall-of-fame")
            .setDescription("Show climbers with achievements"),

        // debug
        new SlashCommandBuilder()
            .setName("debug")
            .setDescription("Show system debug info (Admin or debug role only)")
    ];

    await client.application.commands.set(commands);
    console.log("✅ Slash commands registered");
});

// ----------------- Interaction Handler (commands + components) -----------------
client.on("interactionCreate", async (interaction) => {
    try {
        // ---------- Component (select menu) ----------
        if (interaction.isStringSelectMenu()) {
            // customId format: reward_add:<username>  or reward_remove:<username>
            const [action, encodedName] = interaction.customId.split(":");
            const username = decodeURIComponent(encodedName || "");
            const selectedId = parseInt(interaction.values[0]); // achievement id (string -> number)
            const achv = achievementsConfig.find(a => a.id === selectedId);
            if (!achv) return interaction.update({ content: "⚠️ Achievement not found.", components: [] });

            const robloxData = await getRobloxUser(username);
            if (!robloxData) return interaction.update({ content: "⚠️ Roblox user not found.", components: [] });

            let user = await User.findOne({ robloxId: robloxData.id.toString() });
            if (!user) user = new User({ robloxId: robloxData.id.toString(), robloxUsername: robloxData.name });

            // find guild & log channel safely
            const guild = interaction.guild;
            const rewardLogChannel = guild ? guild.channels.cache.get(config.rewardLogChannelId) : null;

            // Logika Reward Ditambahkan (Kembali ke Log Sederhana)
            if (action === "reward_add") {
                if (!user.achievements.includes(selectedId)) user.achievements.push(selectedId);
                await user.save();

                // Log Internal Sederhana
                if (rewardLogChannel) {
                    const logEmbed = new EmbedBuilder()
                        .setTitle("🎖 Achievement Added")
                        .setColor(config.embedColor)
                        .addFields(
                            { name: "User", value: `${robloxData.name} (${robloxData.id})`, inline: true },
                            { name: "Achievement", value: achv.name, inline: true },
                            { name: "By", value: interaction.user.tag, inline: true }
                        )
                        .setTimestamp();
                    rewardLogChannel.send({ embeds: [logEmbed] }).catch(() => {});
                }

                return interaction.update({ content: `✅ Added **${achv.name}** to **${robloxData.name}**`, components: [] });
            }

            // Logika Reward Dihapus (Tetap Sederhana)
            if (action === "reward_remove") {
                user.achievements = user.achievements.filter(a => a !== selectedId);
                await user.save();

                if (rewardLogChannel) {
                    const logEmbed = new EmbedBuilder()
                        .setTitle("🗑 Achievement Removed")
                        .setColor(config.embedColor)
                        .addFields(
                            { name: "User", value: `${robloxData.name} (${robloxData.id})`, inline: true },
                            { name: "Achievement", value: achv.name, inline: true },
                            { name: "By", value: interaction.user.tag, inline: true }
                        )
                        .setTimestamp();
                    rewardLogChannel.send({ embeds: [logEmbed] }).catch(() => {});
                }

                return interaction.update({ content: `🗑 Removed **${achv.name}** from **${robloxData.name}**`, components: [] });
            }

            return interaction.update({ content: "⚠️ Unknown action.", components: [] });
        }

        // ---------- Chat Input Commands ----------
        if (!interaction.isChatInputCommand()) return;

        const command = interaction.commandName;

        // ---------- /xp ----------
        if (command === "xp") {
            const allowed =
                interaction.member.permissions.has(PermissionFlagsBits.Administrator) ||
                interaction.member.roles.cache.some(r => (config.xpManagerRoles || []).includes(r.id));
            if (!allowed) return interaction.reply({ content: "❌ You do not have permission to use this command.", ephemeral: true });

            const action = interaction.options.getSubcommand();
            const username = interaction.options.getString("username");
            const amount = interaction.options.getInteger("amount");

            const robloxData = await getRobloxUser(username);
            if (!robloxData) return interaction.reply({ content: "⚠️ Roblox user not found.", ephemeral: true });

            const inGroup = await isInRobloxGroup(robloxData.id, config.groupId);
            if (!inGroup) return interaction.reply({ content: "❌ User is not in the community group.", ephemeral: true });

            let user = await User.findOne({ robloxId: robloxData.id.toString() });
            if (!user) user = new User({ robloxId: robloxData.id.toString(), robloxUsername: robloxData.name });

            const oldLevel = getLevel(user.xp).levelName;

            if (action === "add") {
                user.xp += amount;
                user.expeditions = (user.expeditions || 0) + 1;
            }
            if (action === "remove") {
                user.xp = Math.max(user.xp - amount, 0);
                user.expeditions = Math.max((user.expeditions || 0) - 1, 0);
            }
            if (action === "set") user.xp = amount; 

            await user.save();

            const newLevel = getLevel(user.xp).levelName;
            const levelMsg = newLevel !== oldLevel ? ` 🎉 **${robloxData.name} has leveled up to ${newLevel}!**` : "";

            // xp log
            const logFields = [
                { name: "Action", value: action, inline: true },
                { name: "Amount", value: amount.toString(), inline: true },
                { name: "Target", value: `${robloxData.name} (${robloxData.id})`, inline: true },
                { name: "By", value: interaction.user.tag, inline: true },
                { name: "New XP", value: user.xp.toString(), inline: true }
            ];
            if (action === "add" || action === "remove") {
                logFields.push({ name: "Total Expeditions", value: (user.expeditions || 0).toString(), inline: true });
            }

            const xpLogChannel = interaction.guild.channels.cache.get(config.xpLogChannelId);
            if (xpLogChannel) {
                const logEmbed = new EmbedBuilder()
                    .setTitle("📊 XP Log")
                    .setColor(config.embedColor)
                    .addFields(logFields)
                    .setTimestamp();
                xpLogChannel.send({ embeds: [logEmbed] }).catch(() => {});
            }

            return interaction.reply({ content: `✅ ${action} ${amount} XP for **${robloxData.name}**${levelMsg}`, ephemeral: false });
        }

        // ---------- /expo (Expedition Manager) ----------
        if (command === "expo") {
            const allowed =
                interaction.member.permissions.has(PermissionFlagsBits.Administrator) ||
                interaction.member.roles.cache.some(r => (config.xpManagerRoles || []).includes(r.id));
            if (!allowed) return interaction.reply({ content: "❌ You do not have permission to use this command.", ephemeral: true });

            const action = interaction.options.getSubcommand();
            const username = interaction.options.getString("username");
            const amount = interaction.options.getInteger("amount");

            const robloxData = await getRobloxUser(username);
            if (!robloxData) return interaction.reply({ content: "⚠️ Roblox user not found.", ephemeral: true });

            const inGroup = await isInRobloxGroup(robloxData.id, config.groupId);
            if (!inGroup) return interaction.reply({ content: "❌ User is not in the community group.", ephemeral: true });

            let user = await User.findOne({ robloxId: robloxData.id.toString() });
            if (!user) user = new User({ robloxId: robloxData.id.toString(), robloxUsername: robloxData.name });

            const oldExpeditionCount = user.expeditions || 0;
            let newExpeditionCount = oldExpeditionCount;

            if (action === "add") newExpeditionCount += amount;
            if (action === "remove") newExpeditionCount = Math.max(newExpeditionCount - amount, 0);
            if (action === "set") newExpeditionCount = amount;

            user.expeditions = newExpeditionCount;
            await user.save();

            // xp log
            const xpLogChannel = interaction.guild.channels.cache.get(config.xpLogChannelId);
            if (xpLogChannel) {
                const logEmbed = new EmbedBuilder()
                    .setTitle("🗺️ Expedition Log (Manual)")
                    .setColor(config.embedColor)
                    .addFields(
                        { name: "Action", value: action, inline: true },
                        { name: "Amount", value: amount.toString(), inline: true },
                        { name: "Target", value: `${robloxData.name} (${robloxData.id})`, inline: true },
                        { name: "By", value: interaction.user.tag, inline: true },
                        { name: "Old Expeditions", value: oldExpeditionCount.toString(), inline: true },
                        { name: "New Expeditions", value: newExpeditionCount.toString(), inline: true }
                    )
                    .setTimestamp();
                xpLogChannel.send({ embeds: [logEmbed] }).catch(() => {});
            }

            return interaction.reply({ content: `✅ ${action} ${amount} Expedition count for **${robloxData.name}**. Total: **${newExpeditionCount}**`, ephemeral: false });
        }

        // ---------- /reward (add/remove) ----------
        if (command === "reward") {
            const allowed =
                interaction.member.permissions.has(PermissionFlagsBits.Administrator) ||
                interaction.member.roles.cache.some(r => (config.rewardManagerRoles || []).includes(r.id));
            if (!allowed) return interaction.reply({ content: "❌ You do not have permission to use this command.", ephemeral: true });

            const sub = interaction.options.getSubcommand(); // add or remove
            const username = interaction.options.getString("username");
            const robloxData = await getRobloxUser(username);
            if (!robloxData) return interaction.reply({ content: "⚠️ Roblox user not found.", ephemeral: true });

            let user = await User.findOne({ robloxId: robloxData.id.toString() });
            if (!user) user = new User({ robloxId: robloxData.id.toString(), robloxUsername: robloxData.name });

            if (sub === "add") {
                // build select menu with all achievements
                const options = achievementsConfig.map(a => ({
                    label: a.name,
                    description: a.description || "—",
                    value: String(a.id)
                }));
                const menu = new StringSelectMenuBuilder()
                    .setCustomId(`reward_add:${encodeURIComponent(robloxData.name)}`)
                    .setPlaceholder("Select achievement to add")
                    .addOptions(options);
                const row = new ActionRowBuilder().addComponents(menu);
                return interaction.reply({ content: `🎖 Select achievement to give to **${robloxData.name}**`, components: [row], ephemeral: true });
            }

            if (sub === "remove") {
                if (!user.achievements.length) return interaction.reply({ content: "⚠️ User has no achievements.", ephemeral: true });
                const options = user.achievements
                    .map(id => achievementsConfig.find(a => a.id === id))
                    .filter(Boolean)
                    .map(a => ({ label: a.name, description: a.description || "—", value: String(a.id) }));

                if (!options.length) return interaction.reply({ content: "⚠️ No known achievements to remove for this user.", ephemeral: true });

                const menu = new StringSelectMenuBuilder()
                    .setCustomId(`reward_remove:${encodeURIComponent(robloxData.name)}`)
                    .setPlaceholder("Select achievement to remove")
                    .addOptions(options);
                const row = new ActionRowBuilder().addComponents(menu);
                return interaction.reply({ content: `🗑 Select achievement to remove from **${robloxData.name}**`, components: [row], ephemeral: true });
            }
        }

        // ---------- /rank ----------
        if (command === "rank") {
            const username = interaction.options.getString("username");
            const robloxData = await getRobloxUser(username);
            if (!robloxData) return interaction.reply({ content: "⚠️ Roblox user not found.", ephemeral: true });

            let user = await User.findOne({ robloxId: robloxData.id.toString() });
            if (!user) {
                user = new User({ robloxId: robloxData.id.toString(), robloxUsername: robloxData.name, xp: 0 });
                await user.save();
            }

            const avatar = await getRobloxAvatar(robloxData.id);
            const { levelName, bar, progressPercent, xpNeededText } = getLevel(user.xp);

            const achvs = user.achievements
                .map(id => achievementsConfig.find(a => a.id === id)?.name)
                .filter(Boolean)
                .join("\n") || "— None —";

            const embed = new EmbedBuilder()
                .setTitle(`${robloxData.displayName} (@${robloxData.name})`)
                .setURL(`https://www.roblox.com/users/${robloxData.id}/profile`)
                .setThumbnail(avatar)
                .setColor(config.embedColor)
                .addFields(
                    { name: "XP", value: String(user.xp), inline: true },
                    { name: "Level", value: levelName, inline: true },
                    { name: "Expeditions", value: String(user.expeditions || 0), inline: true },
                    { name: "Progress", value: `${bar} (${progressPercent}%)`, inline: false },
                    { name: "Next Level", value: xpNeededText, inline: false },
                    { name: "🏅 Achievements", value: achvs, inline: false }
                );
            return interaction.reply({ embeds: [embed] });
        }

        // ---------- /leaderboard ----------
        if (command === "leaderboard") {
            const limit = 10;
            let page = interaction.options.getInteger("page") || 1;

            const generateEmbed = async (pageNum) => {
                const totalUsers = await User.countDocuments();
                const totalPages = Math.max(1, Math.ceil(totalUsers / limit));
                if (pageNum < 1) pageNum = 1;
                if (pageNum > totalPages) pageNum = totalPages;

                const users = await User.find().sort({ xp: -1 }).skip((pageNum - 1) * limit).limit(limit);
                let desc = "";
                let rank = (pageNum - 1) * limit + 1;
                for (const u of users) {
                    desc += `**#${rank}** - **${u.robloxUsername}** → ${u.xp} XP\n`;
                    rank++;
                }

                return {
                    embeds: [
                        new EmbedBuilder()
                            .setTitle(`🏆 Leaderboard (Page ${pageNum}/${totalPages})`)
                            .setColor(config.embedColor)
                            .setDescription(desc || "⚠️ No users found.")
                    ],
                    components: [
                        new ActionRowBuilder().addComponents(
                            new ButtonBuilder().setCustomId("prev_lb").setLabel("⬅️ Prev").setStyle(ButtonStyle.Primary).setDisabled(pageNum === 1),
                            new ButtonBuilder().setCustomId("next_lb").setLabel("Next ➡️").setStyle(ButtonStyle.Primary).setDisabled(pageNum === totalPages)
                        )
                    ]
                };
            };

            const sent = await interaction.reply(await generateEmbed(page));
            // collector for buttons — ephemeral messages cannot have collectors reliably in all cases; keep non-ephemeral for paging
            const msg = await interaction.fetchReply();
            const collector = msg.createMessageComponentCollector({ time: 60000 });

            collector.on("collect", async (btn) => {
                if (!btn.isButton()) return;
                if (btn.customId === "prev_lb") page--;
                if (btn.customId === "next_lb") page++;
                await btn.update(await generateEmbed(page));
            });

            collector.on("end", async () => {
                try {
                    const final = (await generateEmbed(page));
                    final.components[0].components.forEach(c => c.setDisabled(true));
                    await interaction.editReply(final);
                } catch (e) { /* ignore */ }
            });

            return;
        }

        // ---------- /hall-of-fame ----------
        if (command === "hall-of-fame") {
            const users = await User.find({ achievements: { $exists: true, $ne: [] } }).sort({ xp: -1 });
            if (!users.length) return interaction.reply({ content: "⚠️ No climbers with achievements yet.", ephemeral: true });

            let desc = "";
            for (const u of users) {
                const list = u.achievements.map(id => achievementsConfig.find(a => a.id === id)?.name).filter(Boolean).join(", ");
                desc += `🏅 **${u.robloxUsername}** → ${list}\n`;
            }

            const embed = new EmbedBuilder()
                .setTitle("🏆 Hall of Fame")
                .setColor(config.embedColor)
                .setDescription(desc)
                .setTimestamp();
            return interaction.reply({ embeds: [embed] });
        }

        // ---------- /debug ----------
        if (command === "debug") {
            const allowed =
                interaction.member.permissions.has(PermissionFlagsBits.Administrator) ||
                interaction.member.roles.cache.some(r => (config.debugManagerRoles || []).includes(r.id));
            if (!allowed) return interaction.reply({ content: "❌ You do not have permission to use this command.", ephemeral: true });

            const mongooseState = {
                0: "🔴 Disconnected",
                1: "🟢 Connected",
                2: "🟡 Connecting",
                3: "🟠 Disconnecting"
            }[mongoose.connection.readyState] || "Unknown";

            const totalUsers = await User.countDocuments();
            const users = await User.find({}, { xp: 1, expeditions: 1 }).lean();
            const totalXP = users.reduce((s, u) => s + (u.xp || 0), 0);
            const totalExpeditions = users.reduce((s, u) => s + (u.expeditions || 0), 0); 
            const uptime = Math.floor(process.uptime());
            const h = Math.floor(uptime / 3600);
            const m = Math.floor((uptime % 3600) / 60);

            // ensure commands cache size (fallback to fetch)
            let commandsCount = 0;
            try {
                commandsCount = client.application?.commands?.cache?.size ?? (await client.application.commands.fetch()).size;
            } catch (e) {
                commandsCount = 0;
            }

            const embed = new EmbedBuilder()
                .setTitle("🧠 System Debug Information")
                .setColor(config.embedColor)
                .addFields(
                    { name: "MongoDB", value: mongooseState, inline: true },
                    { name: "Ping", value: `${client.ws.ping}ms`, inline: true },
                    { name: "Guilds Cached", value: String(client.guilds.cache.size), inline: true },
                    { name: "Commands Registered", value: String(commandsCount), inline: true },
                    { name: "Users in DB", value: String(totalUsers), inline: true },
                    { name: "Total XP", value: String(totalXP), inline: true },
                    { name: "Total Expeditions", value: String(totalExpeditions), inline: true }, 
                    { name: "Achievements Configured", value: String(achievementsConfig.length), inline: true },
                    { name: "XP Manager Roles", value: String((config.xpManagerRoles || []).length), inline: true },
                    { name: "Reward Manager Roles", value: String((config.rewardManagerRoles || []).length), inline: true },
                    { name: "Debug Manager Roles", value: String((config.debugManagerRoles || []).length), inline: true },
                    { name: "Bot Uptime", value: `${h}h ${m}m`, inline: true },
                    { name: "Node Version", value: process.version, inline: true }
                )
                .setTimestamp();

            return interaction.reply({ embeds: [embed], ephemeral: true });
        }

    } catch (err) {
        console.error("Interaction handler error:", err);
        if (interaction.replied || interaction.deferred) {
            try { await interaction.editReply({ content: "❌ An error occurred." }); } catch {}
        } else {
            try { await interaction.reply({ content: "❌ An error occurred.", ephemeral: true }); } catch {}
        }
    }
});

// ----------------- Connect Mongo & Login -----------------
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("✅ MongoDB Connected"))
    .catch(err => console.error("MongoDB connection error:", err));

client.login(process.env.TOKEN).catch(err => console.error("Login error:", err));
