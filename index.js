import {
    Client,
    GatewayIntentBits,
    EmbedBuilder,
    PermissionFlagsBits,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    SlashCommandBuilder,
    StringSelectMenuBuilder,
    ModalBuilder, 
    TextInputBuilder, 
    TextInputStyle 
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
    discordId: { type: String, unique: true, sparse: true }, 
    xp: { type: Number, default: 0 },
    expeditions: { type: Number, default: 0 },
    achievements: { type: [Number], default: [] }
});
const User = mongoose.model("User", userSchema);

// ----------------- Helpers -----------------
const levels = config.levels || [];
const achievementsConfig = config.achievements || [];

function getLevel(xp) {
    if (!levels.length) return { levelName: "N/A", bar: "⬜".repeat(10), progressPercent: 0, xpNeededText: "No levels configured" };
    let level = levels[0];
    let index = 0;
    for (let i = 0; i < levels.length; i++) {
        if (xp >= levels[i].xp) {
            level = levels[i];
            index = i;
        } else {
            break;
        }
    }
    const nextLevel = levels[index + 1] || null;

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
            body: JSON.stringify({ usernames: [username], excludeBannedUsers: true })
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
        const res = await fetch(`https://groups.roblox.com/v2/users/${userId}/groups/roles`);
        const data = await res.json();
        if (!data || !data.data) return false;
        return data.data.some(g => g.group.id.toString() === groupId.toString());
    } catch (e) {
        return false;
    }
}

async function getRobloxGroupData(groupId = config.groupId) {
    try {
        const res = await fetch(`https://groups.roblox.com/v1/groups/${groupId}`);
        const data = await res.json();
        if (data && typeof data.memberCount === 'number' && data.name) {
            return {
                name: data.name,
                memberCount: data.memberCount
            };
        }
        return { name: "Roblox Group", memberCount: 0 };
    } catch (e) {
        console.error("Roblox group data fetch error:", e);
        return { name: "Roblox Group", memberCount: 0 };
    }
}

// --- Log Helper ---
function sendLinkLog(guild, title, color, fields) {
    const channelId = config.linkLogChannelId;
    if (!channelId) return;

    const logChannel = guild.channels.cache.get(channelId);
    if (!logChannel) return;

    const logEmbed = new EmbedBuilder()
        .setTitle(title)
        .setColor(color) 
        .addFields(fields)
        .setTimestamp();

    logChannel.send({ embeds: [logEmbed] }).catch(() => {
        console.error("Failed to send link log to channel.");
    });
}

// --- Role Assignment Helper ---
async function assignLinkedRole(member) {
    const roleId = config.linkedRoleId;
    if (!roleId || !member) return;
    try {
        if (!member.roles.cache.has(roleId)) {
            await member.roles.add(roleId, "Account successfully linked.");
        }
        return true;
    } catch (error) {
        console.error(`Failed to assign linked role to ${member.user.tag}:`, error);
        return false;
    }
}

// --- Role Removal Helper ---
async function removeLinkedRole(member) {
    const roleId = config.linkedRoleId;
    if (!roleId || !member) return;
    try {
        if (member.roles.cache.has(roleId)) {
            await member.roles.remove(roleId, "Account unlinked."); 
        }
        return true;
    } catch (error) {
        console.error(`Failed to remove linked role from ${member.user.tag}:`, error);
        return false;
    }
}

// --- Achievement Role Management Helper ---
async function manageAchievementRole(member, achievementId, action) {
    const achv = achievementsConfig.find(a => a.id === achievementId);
    const roleId = achv?.roleId; 

    if (!roleId || !member) return false;

    try {
        if (action === "add") {
            if (!member.roles.cache.has(roleId)) {
                await member.roles.add(roleId, `Achievement obtained: ${achv.name}`);
                return true;
            }
        } else if (action === "remove") {
            if (member.roles.cache.has(roleId)) {
                await member.roles.remove(roleId, `Achievement removed: ${achv.name}`);
                return true;
            }
        }
        return false;
    } catch (error) {
        console.error(`Failed to ${action} achievement role ${roleId} for ${member.user.tag}:`, error);
        return false;
    }
}

// --- Core Verification Logic ---
async function processVerification(interaction, robloxUsername, discordId, isModal = false) {
    if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply(); 
    }

    const replyFn = interaction.editReply;

    const robloxData = await getRobloxUser(robloxUsername);
    if (!robloxData) return replyFn.call(interaction, { content: "⚠️ Roblox user not found. Please check your spelling.", ephemeral: true });
    const robloxId = robloxData.id.toString();

    // 1. Check if Discord user is already linked
    const existingDiscordLink = await User.findOne({ discordId: discordId });
    if (existingDiscordLink) {
        if (existingDiscordLink.robloxId === robloxId) {
            return replyFn.call(interaction, { content: `✅ Your Discord account is already linked to **${robloxData.name}**.\nPastikan Anda memiliki role **Linked Member** (<@&${config.linkedRoleId}>).`, ephemeral: true });
        }
        return replyFn.call(interaction, { 
            content: `❌ Your Discord account is already linked to a different Roblox user: **${existingDiscordLink.robloxUsername}** (${existingDiscordLink.robloxId}). Please contact an admin if you need to change this link.`, 
            ephemeral: true 
        });
    }

    // 2. Check if Roblox account is already linked to another Discord user
    const existingRobloxLink = await User.findOne({ robloxId: robloxId, discordId: { $exists: true, $ne: null } });
    if (existingRobloxLink) {
         return replyFn.call(interaction, { 
            content: `❌ Roblox user **${robloxData.name}** is already linked to another Discord user (<@${existingRobloxLink.discordId}>). Please contact an admin if you believe this is an error.`,
            ephemeral: true
        });
    }

    // 3. Check for group membership
    const inGroup = await isInRobloxGroup(robloxId, config.groupId);
    if (!inGroup) {
        return replyFn.call(interaction, { 
            content: `❌ Verification failed. You must be in the community group (ID: ${config.groupId}) to link your account.`,
            ephemeral: true
        });
    }

    // 4. Link account (Create or Update)
    let user = await User.findOne({ robloxId: robloxId });
    if (!user) {
        user = new User({ 
            robloxId: robloxId, 
            robloxUsername: robloxData.name, 
            discordId: discordId,
            xp: 0 
        });
    } else {
        user.discordId = discordId;
        user.robloxUsername = robloxData.name;
    }
    await user.save();

    // Assign Linked Role
    const member = interaction.guild.members.cache.get(discordId);
    if (member) {
        await assignLinkedRole(member);
    }

    // Public Success Embed (ephemeral: false)
    const embed = new EmbedBuilder()
        .setTitle("✅ Account Successfully Linked!")
        .setDescription(`Discord account **${interaction.user.tag}** is now linked to Roblox user **${user.robloxUsername}**!`)
        .setThumbnail(await getRobloxAvatar(robloxData.id))
        .setColor(config.embedColor) 
        .addFields(
            { name: "Roblox User", value: `${user.robloxUsername} (${user.robloxId})`, inline: true },
            { name: "Discord User", value: `<@${discordId}>`, inline: true }
        );

    // Link Log
    sendLinkLog(interaction.guild, "🔗 Member Self-Service Link", config.embedColor, [ 
        { name: "Roblox User", value: `${user.robloxUsername} (${user.robloxId})`, inline: true },
        { name: "Discord User", value: `<@${discordId}> (${discordId})`, inline: true },
        { name: "Action Type", value: isModal ? "Button Verify" : "Slash Command Verify", inline: true }
    ]);

    // Send final public response (ephemeral: false)
    return replyFn.call(interaction, { embeds: [embed], ephemeral: false });
}


// ----------------- Client -----------------
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

// ----------------- Ready & Register Commands -----------------
client.on("ready", async () => {
    console.log(`✅ Logged in as ${client.user.tag}`);

    const guild = client.guilds.cache.first();

    async function updatePresence() {
        const groupData = await getRobloxGroupData(); 

        const newStatus = `${groupData.name} with ${groupData.memberCount.toLocaleString()} Members`;

        client.user.setPresence({
            activities: [{ 
                name: newStatus, 
                type: 3 
            }],
            status: "online"
        });
        console.log(`Presence updated: ${newStatus}`);
    }

    updatePresence();
    setInterval(updatePresence, 1000 * 60 * 10); 

    // build slash commands
    const commands = [
        // XP (admin/xpManager)
        new SlashCommandBuilder()
            .setName("xp")
            .setDescription("Manage user XP by Roblox Username")
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
            .setDescription("Manage user Expedition count by Roblox Username")
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

        // rank (UPDATED: Optional username OR user, defaults to self)
        new SlashCommandBuilder()
            .setName("rank")
            .setDescription("Check rank of a Roblox user or yourself")
            .addStringOption(opt => opt.setName("username").setDescription("Roblox username (Opsional)").setRequired(false))
            .addUserOption(opt => opt.setName("user").setDescription("Discord user (@mention)").setRequired(false)), 

        // leaderboard
        new SlashCommandBuilder()
            .setName("leaderboard")
            .setDescription("Show XP or Expedition leaderboard")
            .addStringOption(opt => 
                opt.setName("type")
                    .setDescription("Type of leaderboard (XP or Expedition)")
                    .setRequired(false)
                    .addChoices(
                        { name: 'XP', value: 'xp' },
                        { name: 'Expedition', value: 'expo' },
                    )
            )
            .addIntegerOption(opt => opt.setName("page").setDescription("Page number").setRequired(false)),

        // reward (interactive add/remove)
        new SlashCommandBuilder()
            .setName("reward")
            .setDescription("Give or remove achievements by Roblox Username (interactive)")
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

        // **FIXED: XP Direct (Targeted by Discord User)**
        new SlashCommandBuilder()
            .setName("xpd")
            .setDescription("Manage XP for a linked Discord user")
            .addSubcommand(sub =>
                sub.setName("add").setDescription("Add XP")
                    .addUserOption(opt => opt.setName("user").setDescription("Discord user to target").setRequired(true))
                    .addIntegerOption(opt => opt.setName("amount").setDescription("XP amount").setRequired(true))
            )
            .addSubcommand(sub =>
                sub.setName("remove").setDescription("Remove XP")
                    .addUserOption(opt => opt.setName("user").setDescription("Discord user to target").setRequired(true))
                    .addIntegerOption(opt => opt.setName("amount").setDescription("XP amount").setRequired(true))
            )
            .addSubcommand(sub =>
                sub.setName("set").setDescription("Set XP")
                    .addUserOption(opt => opt.setName("user").setDescription("Discord user to target").setRequired(true))
                    .addIntegerOption(opt => opt.setName("amount").setDescription("XP amount").setRequired(true))
            ),

        // **FIXED: Expedition Direct (Targeted by Discord User)**
        new SlashCommandBuilder()
            .setName("expod")
            .setDescription("Manage Expedition count for a linked Discord user")
            .addSubcommand(sub =>
                sub.setName("add").setDescription("Add expeditions count")
                    .addUserOption(opt => opt.setName("user").setDescription("Discord user to target").setRequired(true))
                    .addIntegerOption(opt => opt.setName("amount").setDescription("Expedition amount").setRequired(true))
            )
            .addSubcommand(sub =>
                sub.setName("remove").setDescription("Remove expeditions count")
                    .addUserOption(opt => opt.setName("user").setDescription("Discord user to target").setRequired(true))
                    .addIntegerOption(opt => opt.setName("amount").setDescription("Expedition amount").setRequired(true))
            )
            .addSubcommand(sub =>
                sub.setName("set").setDescription("Set expeditions count")
                    .addUserOption(opt => opt.setName("user").setDescription("Discord user to target").setRequired(true))
                    .addIntegerOption(opt => opt.setName("amount").setDescription("Expedition amount").setRequired(true))
            ),

        // **FIXED: Reward Direct (Targeted by Discord User)**
        new SlashCommandBuilder()
            .setName("rwrd")
            .setDescription("Give or remove achievements for a linked Discord user (Interactive)")
            .addSubcommand(sub =>
                sub.setName("add")
                    .setDescription("Give an achievement")
                    .addUserOption(opt => opt.setName("user").setDescription("Discord user to target").setRequired(true))
            )
            .addSubcommand(sub =>
                sub.setName("remove")
                    .setDescription("Remove an achievement")
                    .addUserOption(opt => opt.setName("user").setDescription("Discord user to target").setRequired(true))
            ),

        // hall-of-fame
        new SlashCommandBuilder()
            .setName("hall-of-fame")
            .setDescription("Show climbers with achievements"),

        // **NEW: List All Rewards**
        new SlashCommandBuilder()
            .setName("list-reward")
            .setDescription("Show a list of all available achievements/rewards"),

        // link (Admin Only: initiate, member, remove, status)
        new SlashCommandBuilder()
            .setName("link")
            .setDescription("Admin command to manage account linking status")
            .addSubcommand(sub =>
                sub.setName("initiate")
                    .setDescription("Register a Roblox account and instruct the member to verify.")
                    .addStringOption(opt => opt.setName("username").setDescription("Roblox username to register").setRequired(true))
            )
            .addSubcommand(sub =>
                sub.setName("member") 
                    .setDescription("Manually link a Discord user to a Roblox account (Force link)")
                    .addStringOption(opt => opt.setName("username").setDescription("Roblox username").setRequired(true))
                    .addUserOption(opt => opt.setName("user").setDescription("Discord member to link").setRequired(true))
            )
            .addSubcommand(sub => 
                sub.setName("remove") 
                    .setDescription("Remove the Discord link from a Roblox account.")
                    .addStringOption(opt => opt.setName("username").setDescription("Roblox username to unlink").setRequired(true))
            )
            .addSubcommand(sub =>
                sub.setName("status")
                    .setDescription("Check link status of a Roblox user")
                    .addStringOption(opt => opt.setName("username").setDescription("Roblox username").setRequired(true))
            ),

        // verify (Member self-service linking)
        new SlashCommandBuilder()
            .setName("verify")
            .setDescription("Account verification commands")
            .addSubcommand(sub =>
                sub.setName("account") 
                    .setDescription("Link your Discord account to your Roblox account (Self-Service).")
                    .addStringOption(opt => opt.setName("username").setDescription("Your Roblox username").setRequired(true))
            )
            .addSubcommand(sub => 
                sub.setName("setup")
                    .setDescription("Admin command to send a verification button message.")
            ),

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
        // ---------- Modal Submission Handler ----------
        if (interaction.isModalSubmit() && interaction.customId === 'verify_modal') {
            await interaction.deferReply({ ephemeral: true }); 
            const robloxUsername = interaction.fields.getTextInputValue('roblox_username_input');
            const discordId = interaction.user.id.toString();

            await processVerification(interaction, robloxUsername, discordId, true); 
            return;
        }

        // ---------- Button Handler (Verify Button & Leaderboard Button) ----------
        if (interaction.isButton()) {
            if (interaction.customId === 'verify_start') {
                const modal = new ModalBuilder()
                    .setCustomId('verify_modal')
                    .setTitle('Link Your Roblox Account');

                const usernameInput = new TextInputBuilder()
                    .setCustomId('roblox_username_input')
                    .setLabel("Your Roblox Username")
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('e.g., Builderman')
                    .setRequired(true);

                const firstActionRow = new ActionRowBuilder().addComponents(usernameInput);

                await interaction.showModal(modal.addComponents(firstActionRow));
                return;
            }

            // Leaderboard button logic
            if (interaction.customId.startsWith('lb_')) {
                const parts = interaction.customId.split("_");
                const btnAction = parts[1]; 
                const btnType = parts[2]; 
                let currentPage = parseInt(parts[3]); 

                let newType = btnType;
                let newPage = currentPage;

                if (btnAction === 'switch') {
                    newType = btnType;
                    newPage = 1; 
                } else if (btnAction === 'prev') {
                    newPage = currentPage - 1;
                } else if (btnAction === 'next') {
                    newPage = currentPage + 1;
                }

                const generateEmbed = async (pageNum, lbType) => {
                    const limit = 10;
                    const sortField = lbType === 'expo' ? 'expeditions' : 'xp';
                    const sortTitle = lbType === 'expo' ? 'Expedition' : 'XP';

                    const totalUsers = await User.countDocuments();
                    const totalPages = Math.max(1, Math.ceil(totalUsers / limit));
                    if (pageNum < 1) pageNum = 1;
                    if (pageNum > totalPages) pageNum = totalPages;

                    const users = await User.find()
                        .sort({ [sortField]: -1, robloxId: 1 }) 
                        .skip((pageNum - 1) * limit)
                        .limit(limit);

                    let desc = "";
                    let rank = (pageNum - 1) * limit + 1;
                    for (const u of users) {
                        const value = u[sortField] || 0; 
                        desc += `**#${rank}** - **${u.robloxUsername}** → ${value} ${sortTitle}\n`;
                        rank++;
                    }

                    const buttonRow = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId(`lb_prev_${lbType}_${pageNum}`).setLabel("⬅️ Prev").setStyle(ButtonStyle.Primary).setDisabled(pageNum === 1),
                        new ButtonBuilder().setCustomId(`lb_next_${lbType}_${pageNum}`).setLabel("Next ➡️").setStyle(ButtonStyle.Primary).setDisabled(pageNum === totalPages)
                    );

                    const switchRow = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId(`lb_switch_${lbType === 'xp' ? 'expo' : 'xp'}_${pageNum}`).setLabel(`Switch to ${lbType === 'xp' ? 'Expedition' : 'XP'} LB`).setStyle(ButtonStyle.Secondary)
                    );


                    return {
                        embeds: [
                            new EmbedBuilder()
                                .setTitle(`🏆 Leaderboard ${sortTitle} (Page ${pageNum}/${totalPages})`)
                                .setColor(config.embedColor)
                                .setDescription(desc || "⚠️ No users found.")
                        ],
                        components: [buttonRow, switchRow]
                    };
                };

                await interaction.update(await generateEmbed(newPage, newType));
                return;
            }
        }


        // ---------- Component (select menu) MODIFIED for /rwrd & Role Management ----------
        if (interaction.isStringSelectMenu()) {

            // customId format: reward_add:<robloxUsername> OR rwrd_add:<discordId>
            const [actionPrefix, encodedIdentifier] = interaction.customId.split(":");
            const identifier = decodeURIComponent(encodedIdentifier || "");
            const selectedId = parseInt(interaction.values[0]); 
            const achv = achievementsConfig.find(a => a.id === selectedId);
            if (!achv) return interaction.update({ content: "⚠️ Achievement not found.", components: [] });

            let robloxData = null;
            let user = null;
            let member = null; // Discord Member object for role management

            if (actionPrefix.startsWith("rwrd_")) {
                // Command /rwrd menggunakan Discord ID sebagai identifier
                const discordId = identifier;
                member = interaction.guild.members.cache.get(discordId);
                user = await User.findOne({ discordId: discordId });
                if (!user) return interaction.update({ content: "⚠️ Akun Discord target belum terhubung dengan Roblox (atau pengguna tidak ditemukan di DB).", components: [] });
                // Fetch Roblox data (optional, for logging)
                robloxData = { name: user.robloxUsername, id: user.robloxId }; 
            } else {
                // Command /reward menggunakan Roblox Username sebagai identifier
                const username = identifier;
                robloxData = await getRobloxUser(username);
                if (!robloxData) return interaction.update({ content: "⚠️ Roblox user not found.", components: [] });
                user = await User.findOne({ robloxId: robloxData.id.toString() });
                if (!user) user = new User({ robloxId: robloxData.id.toString(), robloxUsername: robloxData.name });
                if (user.discordId) member = interaction.guild.members.cache.get(user.discordId);
            }

            if (!user) return interaction.update({ content: "⚠️ Gagal mengambil data pengguna untuk manajemen achievement.", components: [] });

            const guild = interaction.guild;
            const rewardLogChannel = guild ? guild.channels.cache.get(config.rewardLogChannelId) : null;
            const targetName = user.robloxUsername; 

            if (actionPrefix.endsWith("_add")) {
                if (!user.achievements.includes(selectedId)) {
                    user.achievements.push(selectedId);
                    if (member) await manageAchievementRole(member, selectedId, "add");
                }
                await user.save();

                if (rewardLogChannel) {
                    const logEmbed = new EmbedBuilder().setTitle("🎖 Achievement Added").setColor(config.embedColor)
                        .addFields({ name: "User", value: `${targetName} (${user.robloxId})`, inline: true },
                            { name: "Achievement", value: achv.name, inline: true }, { name: "By", value: interaction.user.tag, inline: true }).setTimestamp();
                    rewardLogChannel.send({ embeds: [logEmbed] }).catch(() => {});
                }

                return interaction.update({ content: `✅ Added **${achv.name}** to **${targetName}**`, components: [] });
            }

            if (actionPrefix.endsWith("_remove")) {
                user.achievements = user.achievements.filter(a => a !== selectedId);
                if (member) await manageAchievementRole(member, selectedId, "remove");
                await user.save();

                if (rewardLogChannel) {
                    const logEmbed = new EmbedBuilder().setTitle("🗑 Achievement Removed").setColor(config.embedColor)
                        .addFields({ name: "User", value: `${targetName} (${user.robloxId})`, inline: true },
                            { name: "Achievement", value: achv.name, inline: true }, { name: "By", value: interaction.user.tag, inline: true }).setTimestamp();
                    rewardLogChannel.send({ embeds: [logEmbed] }).catch(() => {});
                }

                return interaction.update({ content: `🗑 Removed **${achv.name}** from **${targetName}**`, components: [] });
            }

            return interaction.update({ content: "⚠️ Unknown action.", components: [] });
        }

        // ---------- Chat Input Commands ----------
        if (!interaction.isChatInputCommand()) return;

        const command = interaction.commandName;

        // ---------- /xp & /expo (Admin Logic - Roblox Username) ----------
        if (command === "xp" || command === "expo") {
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
            if (!user) user = new User({ robloxId: robloxData.id.toString(), robloxUsername: robloxData.name, xp: 0, expeditions: 0 });

            if (robloxData.name !== user.robloxUsername) { 
                user.robloxUsername = robloxData.name;
            }

            // XP Logic
            if (command === "xp") {
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
                    const logEmbed = new EmbedBuilder().setTitle("📊 XP Log (By Roblox Name)").setColor(config.embedColor).addFields(logFields).setTimestamp();
                    xpLogChannel.send({ embeds: [logEmbed] }).catch(() => {});
                }

                return interaction.reply({ content: `✅ ${action} ${amount} XP for **${robloxData.name}**${levelMsg}`, ephemeral: false });

            // Expedition Logic
            } else if (command === "expo") {
                const oldExpeditionCount = user.expeditions || 0;
                let newExpeditionCount = oldExpeditionCount;

                if (action === "add") newExpeditionCount += amount;
                if (action === "remove") newExpeditionCount = Math.max(newExpeditionCount - amount, 0);
                if (action === "set") newExpeditionCount = amount;

                user.expeditions = newExpeditionCount;
                await user.save();

                const xpLogChannel = interaction.guild.channels.cache.get(config.xpLogChannelId);
                if (xpLogChannel) {
                    const logEmbed = new EmbedBuilder().setTitle("🗺️ Expedition Log (By Roblox Name)").setColor(config.embedColor)
                        .addFields({ name: "Action", value: action, inline: true }, { name: "Amount", value: amount.toString(), inline: true },
                            { name: "Target", value: `${robloxData.name} (${robloxData.id})`, inline: true }, { name: "By", value: interaction.user.tag, inline: true },
                            { name: "Old Expeditions", value: oldExpeditionCount.toString(), inline: true }, { name: "New Expeditions", value: newExpeditionCount.toString(), inline: true }).setTimestamp();
                    xpLogChannel.send({ embeds: [logEmbed] }).catch(() => {});
                }

                return interaction.reply({ content: `✅ ${action} ${amount} Expedition count for **${robloxData.name}**. Total: **${newExpeditionCount}**`, ephemeral: false });
            }
        }

        // **FIXED: /xpd & /expod (Targeted by Discord User)**
        if (command === "xpd" || command === "expod") {
            const allowed =
                interaction.member.permissions.has(PermissionFlagsBits.Administrator) ||
                interaction.member.roles.cache.some(r => (config.xpManagerRoles || []).includes(r.id));
            if (!allowed) return interaction.reply({ content: "❌ You do not have permission to use this command.", ephemeral: true });

            const action = interaction.options.getSubcommand();
            const amount = interaction.options.getInteger("amount");
            const targetUserOption = interaction.options.getUser("user"); // <--- GET TARGET USER

            if (!targetUserOption) return interaction.reply({ content: "❌ Opsi 'user' harus diisi.", ephemeral: true });

            const targetDiscordId = targetUserOption.id.toString();

            let user = await User.findOne({ discordId: targetDiscordId });
            if (!user) {
                return interaction.reply({ 
                    content: `❌ Akun Discord **${targetUserOption.tag}** (${targetDiscordId}) belum terhubung dengan akun Roblox. Silakan minta mereka untuk menghubungkan akun terlebih dahulu.`, 
                    ephemeral: true 
                });
            }

            // XP Logic
            if (command === "xpd") {
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
                const levelMsg = newLevel !== oldLevel ? ` 🎉 **${user.robloxUsername} telah naik level ke ${newLevel}!**` : "";

                const logFields = [
                    { name: "Action", value: action, inline: true },
                    { name: "Amount", value: amount.toString(), inline: true },
                    { name: "Target (Roblox)", value: `${user.robloxUsername} (${user.robloxId})`, inline: false },
                    { name: "Target (Discord)", value: targetUserOption.tag, inline: true },
                    { name: "By", value: interaction.user.tag, inline: true },
                    { name: "New XP", value: user.xp.toString(), inline: true }
                ];
                if (action === "add" || action === "remove") {
                    logFields.push({ name: "Total Expeditions", value: (user.expeditions || 0).toString(), inline: true });
                }

                const xpLogChannel = interaction.guild.channels.cache.get(config.xpLogChannelId);
                if (xpLogChannel) {
                    const logEmbed = new EmbedBuilder().setTitle("📊 XP Log (By Discord User)").setColor(config.embedColor).addFields(logFields).setTimestamp();
                    xpLogChannel.send({ embeds: [logEmbed] }).catch(() => {});
                }

                return interaction.reply({ content: `✅ ${action} ${amount} XP untuk **${user.robloxUsername}** (${targetUserOption.tag})${levelMsg}`, ephemeral: false });

            } else if (command === "expod") {
                const oldExpeditionCount = user.expeditions || 0;
                let newExpeditionCount = oldExpeditionCount;

                if (action === "add") newExpeditionCount += amount;
                if (action === "remove") newExpeditionCount = Math.max(newExpeditionCount - amount, 0);
                if (action === "set") newExpeditionCount = amount;

                user.expeditions = newExpeditionCount;
                await user.save();

                const xpLogChannel = interaction.guild.channels.cache.get(config.xpLogChannelId);
                if (xpLogChannel) {
                    const logEmbed = new EmbedBuilder().setTitle("🗺️ Expedition Log (By Discord User)").setColor(config.embedColor)
                        .addFields({ name: "Action", value: action, inline: true }, { name: "Amount", value: amount.toString(), inline: true },
                            { name: "Target (Roblox)", value: `${user.robloxUsername} (${user.robloxId})`, inline: false },
                            { name: "Target (Discord)", value: targetUserOption.tag, inline: true }, 
                            { name: "By", value: interaction.user.tag, inline: true },
                            { name: "New Expeditions", value: newExpeditionCount.toString(), inline: true }).setTimestamp();
                    xpLogChannel.send({ embeds: [logEmbed] }).catch(() => {});
                }

                return interaction.reply({ content: `✅ ${action} ${amount} Expedition count untuk **${user.robloxUsername}** (${targetUserOption.tag}). Total: **${newExpeditionCount}**`, ephemeral: false });
            }
        }

        // ---------- /rank (UPDATED Logic) ----------
        if (command === "rank") {
            const usernameInput = interaction.options.getString("username");
            const discordUserOption = interaction.options.getUser("user"); 

            await interaction.deferReply();

            let robloxData = null;
            let dbUser = null;
            let targetDiscordId = null;

            if (discordUserOption) {
                // Scenario 1: Search by provided Discord User
                targetDiscordId = discordUserOption.id.toString();
                dbUser = await User.findOne({ discordId: targetDiscordId });
                if (dbUser) {
                    robloxData = await getRobloxUser(dbUser.robloxUsername);
                }

                if (!dbUser || !robloxData) {
                    return interaction.editReply({ 
                        content: `⚠️ Pengguna Discord ${discordUserOption.tag} belum terhubung ke akun Roblox.` 
                    });
                }

            } else if (usernameInput) {
                // Scenario 2: Search by provided Roblox Username
                robloxData = await getRobloxUser(usernameInput);
                if (!robloxData) return interaction.editReply({ content: "⚠️ Roblox user not found." });
                dbUser = await User.findOne({ robloxId: robloxData.id.toString() });

            } else {
                // Scenario 3: Search by the running user's Discord ID (Default)
                targetDiscordId = interaction.user.id.toString();
                dbUser = await User.findOne({ discordId: targetDiscordId });
                if (dbUser) {
                    robloxData = await getRobloxUser(dbUser.robloxUsername);
                }

                if (!dbUser || !robloxData) {
                    return interaction.editReply({ 
                        content: "⚠️ Akun Discord Anda belum terhubung ke akun Roblox. Silakan hubungkan akun Anda menggunakan `/verify account [username]` atau tombol verifikasi." 
                    });
                }
            }

            // Fallback: If robloxData is found but dbUser is not (unlinked, but exists on Roblox), create/update entry.
            if (robloxData && !dbUser) {
                 dbUser = new User({ robloxId: robloxData.id.toString(), robloxUsername: robloxData.name, xp: 0 });
                 await dbUser.save();
            } else if (dbUser && robloxData && robloxData.name !== dbUser.robloxUsername) {
                // Update username if different
                dbUser.robloxUsername = robloxData.name;
                await dbUser.save();
            }

            if (!dbUser || !robloxData) return interaction.editReply({ content: "⚠️ Gagal mengambil data rank." });

            const avatar = await getRobloxAvatar(robloxData.id);
            const { levelName, bar, progressPercent, xpNeededText } = getLevel(dbUser.xp);

            const achvs = dbUser.achievements
                .map(id => achievementsConfig.find(a => a.id === id)?.name)
                .filter(Boolean)
                .join("\n") || "— None —";

            const embed = new EmbedBuilder()
                .setTitle(`${robloxData.displayName} (@${robloxData.name})`)
                .setURL(`https://www.roblox.com/users/${robloxData.id}/profile`)
                .setThumbnail(avatar)
                .setColor(config.embedColor)
                .addFields(
                    { name: "Discord User", value: dbUser.discordId ? `<@${dbUser.discordId}>` : "— Not Linked —", inline: true }, 
                    { name: "XP", value: String(dbUser.xp), inline: true },
                    { name: "Level", value: levelName, inline: true },
                    { name: "Expeditions", value: String(dbUser.expeditions || 0), inline: true }, 
                    { name: "Progress", value: `${bar} (${progressPercent}%)`, inline: false },
                    { name: "Next Level", value: xpNeededText, inline: false },
                    { name: "🏅 Achievements", value: achvs, inline: false }
                );
            return interaction.editReply({ embeds: [embed] });
        }

        // ---------- /verify (account & setup) ----------
        if (command === "verify") {
            const sub = interaction.options.getSubcommand();

            if (sub === "setup") { 
                const allowed =
                    interaction.member.permissions.has(PermissionFlagsBits.Administrator) ||
                    interaction.member.roles.cache.some(r => (config.linkManagerRoles || []).includes(r.id));
                if (!allowed) return interaction.reply({ content: "❌ You do not have permission to use this command.", ephemeral: true });

                const embed = new EmbedBuilder()
                    .setTitle("🔑 Roblox Account Verification")
                    .setDescription(`To link your Discord account to your Roblox account and gain member roles, please click the button below. You will be asked to input your Roblox username via a popup.`)
                    .setColor(config.embedColor)
                    .setFooter({ text: "Ensure you are in the Roblox Group before verifying!" });

                const button = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId("verify_start")
                        .setLabel("🔗 Verify Account")
                        .setStyle(ButtonStyle.Success)
                );

                await interaction.reply({ 
                    content: "✅ Verification setup message sent. (Lihat di Channel ini)", 
                    ephemeral: true 
                });

                // Send the public message to the channel
                return interaction.channel.send({
                    embeds: [embed],
                    components: [button]
                });
            }

            if (sub === "account") { 
                const robloxUsername = interaction.options.getString("username");
                const discordId = interaction.user.id.toString();

                await processVerification(interaction, robloxUsername, discordId, false);
                return;
            }
        }


        // ---------- /link (Admin Logic) ----------
        if (command === "link") {
            const allowed =
                interaction.member.permissions.has(PermissionFlagsBits.Administrator) ||
                interaction.member.roles.cache.some(r => (config.linkManagerRoles || []).includes(r.id));
            if (!allowed) return interaction.reply({ content: "❌ You do not have permission to use this command.", ephemeral: true });

            const sub = interaction.options.getSubcommand();
            await interaction.deferReply({ ephemeral: true });

            if (sub === "initiate") {
                const robloxUsername = interaction.options.getString("username");

                const robloxData = await getRobloxUser(robloxUsername);
                if (!robloxData) return interaction.editReply({ content: "⚠️ Roblox user not found." });

                const existingLink = await User.findOne({ robloxId: robloxData.id.toString(), discordId: { $exists: true, $ne: null } });
                if (existingLink) {
                    return interaction.editReply({ content: `❌ Roblox user **${robloxData.name}** is already linked to <@${existingLink.discordId}>.` });
                }

                let user = await User.findOne({ robloxId: robloxData.id.toString() });
                if (!user) {
                    user = new User({ robloxId: robloxData.id.toString(), robloxUsername: robloxData.name, xp: 0 });
                } else if (user.robloxUsername !== robloxData.name) {
                    user.robloxUsername = robloxData.name;
                }
                await user.save(); 

                const embed = new EmbedBuilder()
                    .setTitle("🔗 Linking Instruction (Admin Action)")
                    .setDescription(`Roblox user **${robloxData.name}** has been registered in the database.`)
                    .addFields(
                        { name: "Next Step for Member", value: `Please instruct the member to run the command **\`/verify account username: ${robloxData.name}\`** atau klik tombol di pesan \`/verify setup\`.`, inline: false }
                    )
                    .setFooter({ text: `Roblox ID: ${robloxData.id}` })
                    .setColor(config.embedColor);

                sendLinkLog(interaction.guild, "👤 Link Initiation (Admin)", config.embedColor, [ 
                    { name: "Roblox User Registered", value: `${robloxData.name} (${robloxData.id})`, inline: true },
                    { name: "Admin", value: interaction.user.tag, inline: true },
                    { name: "Status", value: "Waiting for Member Verification (`/verify account` / Button)", inline: false }
                ]);

                return interaction.editReply({ embeds: [embed] });
            }

            if (sub === "member") { 
                const robloxUsername = interaction.options.getString("username");
                const discordUser = interaction.options.getUser("user");
                const discordId = discordUser.id.toString();

                const robloxData = await getRobloxUser(robloxUsername);
                if (!robloxData) return interaction.editReply({ content: "⚠️ Roblox user not found." });
                const robloxId = robbloxData.id.toString();

                const existingDiscordLink = await User.findOne({ discordId: discordId });
                if (existingDiscordLink) {
                    const oldMember = interaction.guild.members.cache.get(existingDiscordLink.discordId);
                    if (oldMember) await removeLinkedRole(oldMember); 

                    existingDiscordLink.discordId = null; 
                    await existingDiscordLink.save();
                }

                let user = await User.findOneAndUpdate(
                    { robloxId: robloxId },
                    { $set: { discordId: discordId, robloxUsername: robloxData.name } },
                    { new: true, upsert: true }
                );

                const member = interaction.guild.members.cache.get(discordId);
                if (member) {
                    await assignLinkedRole(member);
                }

                const inGroup = await isInRobloxGroup(robloxId, config.groupId);
                const groupStatus = inGroup ? "✅ Is in the group" : "⚠️ NOT in the group (Linked anyway by admin)";

                const embed = new EmbedBuilder()
                    .setTitle("✅ Manual Link Successful (Admin Override)")
                    .setDescription(`Discord user **${discordUser.tag}** has been manually linked to Roblox user **${user.robloxUsername}** by ${interaction.user.tag}.`)
                    .setColor(config.embedColor) 
                    .addFields(
                        { name: "Roblox User", value: `${user.robloxUsername} (${user.robloxId})`, inline: true },
                        { name: "Discord User", value: discordUser.toString(), inline: true },
                        { name: "Group Status", value: groupStatus, inline: false }
                    )
                    .setFooter({ text: `Action by: ${interaction.user.tag}` });

                sendLinkLog(interaction.guild, "🛠️ Manual Account Link (Admin Override)", config.embedColor, [
                    { name: "Roblox User", value: `${user.robloxUsername} (${user.robloxId})`, inline: true },
                    { name: "Linked Discord User", value: `<@${discordId}> (${discordId})`, inline: true },
                    { name: "Admin", value: interaction.user.tag, inline: true },
                    { name: "Old Link Status", value: existingDiscordLink ? `Unlinked old account: ${existingDiscordLink.robloxUsername}` : "No old Discord link removed", inline: false }
                ]);

                return interaction.editReply({ embeds: [embed] });
            }

            if (sub === "remove") { 
                const robloxUsername = interaction.options.getString("username");

                const robloxData = await getRobloxUser(robloxUsername);
                if (!robloxData) return interaction.editReply({ content: "⚠️ Roblox user not found." });
                const robloxId = robloxData.id.toString();

                let user = await User.findOne({ robloxId: robloxId });

                if (!user) {
                    return interaction.editReply({ content: `⚠️ Roblox user **${robloxData.name}** is not registered in the database.` });
                }

                if (!user.discordId) {
                    return interaction.editReply({ content: `✅ Roblox user **${robloxData.name}** is already unlinked.` });
                }

                const oldDiscordId = user.discordId;

                user.discordId = null;
                await user.save(); 

                const member = interaction.guild.members.cache.get(oldDiscordId);
                if (member) {
                    await removeLinkedRole(member); 
                }

                const embed = new EmbedBuilder()
                    .setTitle("✅ Account Unlink Successful (Admin Action)")
                    .setDescription(`The link between Roblox user **${user.robloxUsername}** and Discord user <@${oldDiscordId}> has been removed by ${interaction.user.tag}.`)
                    .setColor(config.embedColor) 
                    .addFields(
                        { name: "Roblox User", value: `${user.robloxUsername} (${user.robloxId})`, inline: true },
                        { name: "Unlinked Discord ID", value: oldDiscordId, inline: true },
                        { name: "Role Removed", value: member ? "Yes" : "No (Member not found/in cache)", inline: true }
                    )
                    .setFooter({ text: `Action by: ${interaction.user.tag}` });

                sendLinkLog(interaction.guild, "🗑️ Manual Account Unlink (Admin)", config.embedColor, [
                    { name: "Roblox User Unlinked", value: `${user.robloxUsername} (${user.robloxId})`, inline: true },
                    { name: "Unlinked Discord ID", value: oldDiscordId, inline: true },
                    { name: "Admin", value: interaction.user.tag, inline: true }
                ]);

                return interaction.editReply({ embeds: [embed] });
            }

            if (sub === "status") {
                const robloxUsername = interaction.options.getString("username");

                const robloxData = await getRobloxUser(robloxUsername);
                if (!robloxData) return interaction.editReply({ content: "⚠️ Roblox user not found." });

                const user = await User.findOne({ robloxId: robloxData.id.toString() });

                let status = "❌ Not Found in DB (Can be verified)";
                let discordTag = "—";

                if (user) {
                    if (user.discordId) {
                         status = "✅ Successfully Linked";
                         discordTag = `<@${user.discordId}> (${user.discordId})`;
                    } else {
                        status = "🟡 In DB, Not Linked";
                    }
                }

                const embed = new EmbedBuilder()
                    .setTitle(`Link Status for ${robloxData.name}`)
                    .setColor(config.embedColor)
                    .addFields(
                        { name: "Roblox ID", value: robloxData.id.toString(), inline: true },
                        { name: "Status", value: status, inline: true },
                        { name: "Linked Discord User", value: discordTag, inline: false }
                    );

                return interaction.editReply({ embeds: [embed] });
            }
        }


        // ---------- /reward (Roblox Username) ----------
        if (command === "reward") {
            const allowed =
                interaction.member.permissions.has(PermissionFlagsBits.Administrator) ||
                interaction.member.roles.cache.some(r => (config.rewardManagerRoles || []).includes(r.id));
            if (!allowed) return interaction.reply({ content: "❌ You do not have permission to use this command.", ephemeral: true });

            const sub = interaction.options.getSubcommand(); 
            const username = interaction.options.getString("username");
            const robloxData = await getRobloxUser(username);
            if (!robloxData) return interaction.reply({ content: "⚠️ Roblox user not found.", ephemeral: true });

            let user = await User.findOne({ robloxId: robloxData.id.toString() });
            if (!user) user = new User({ robloxId: robloxData.id.toString(), robloxUsername: robloxData.name });

            if (sub === "add") {
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

        // **FIXED: /rwrd (Targeted by Discord User)**
        if (command === "rwrd") {
            const allowed =
                interaction.member.permissions.has(PermissionFlagsBits.Administrator) ||
                interaction.member.roles.cache.some(r => (config.rewardManagerRoles || []).includes(r.id));
            if (!allowed) return interaction.reply({ content: "❌ You do not have permission to use this command.", ephemeral: true });

            const sub = interaction.options.getSubcommand();
            const targetUserOption = interaction.options.getUser("user"); // <--- GET TARGET USER

            if (!targetUserOption) return interaction.reply({ content: "❌ Opsi 'user' harus diisi.", ephemeral: true });

            const targetDiscordId = targetUserOption.id.toString();

            let user = await User.findOne({ discordId: targetDiscordId });
            if (!user) {
                return interaction.reply({ 
                    content: `❌ Akun Discord **${targetUserOption.tag}** (${targetDiscordId}) belum terhubung dengan akun Roblox.`, 
                    ephemeral: true 
                });
            }

            const targetName = user.robloxUsername; 

            if (sub === "add") {
                const options = achievementsConfig.map(a => ({
                    label: a.name,
                    description: a.description || "—",
                    value: String(a.id)
                }));
                const menu = new StringSelectMenuBuilder()
                    .setCustomId(`rwrd_add:${encodeURIComponent(targetDiscordId)}`) // Menggunakan Target Discord ID
                    .setPlaceholder("Select achievement to add")
                    .addOptions(options);
                const row = new ActionRowBuilder().addComponents(menu);
                return interaction.reply({ content: `🎖 Pilih achievement untuk diberikan kepada **${targetName}** (<@${targetDiscordId}>)`, components: [row], ephemeral: true });
            }

            if (sub === "remove") {
                if (!user.achievements.length) return interaction.reply({ content: "⚠️ Pengguna belum memiliki achievement.", ephemeral: true });
                const options = user.achievements
                    .map(id => achievementsConfig.find(a => a.id === id))
                    .filter(Boolean)
                    .map(a => ({ label: a.name, description: a.description || "—", value: String(a.id) }));

                if (!options.length) return interaction.reply({ content: "⚠️ Tidak ada achievement yang diketahui untuk dihapus dari pengguna ini.", ephemeral: true });

                const menu = new StringSelectMenuBuilder()
                    .setCustomId(`rwrd_remove:${encodeURIComponent(targetDiscordId)}`) // Menggunakan Target Discord ID
                    .setPlaceholder("Select achievement to remove")
                    .addOptions(options);
                const row = new ActionRowBuilder().addComponents(menu);
                return interaction.reply({ content: `🗑 Pilih achievement untuk dihapus dari **${targetName}** (<@${targetDiscordId}>)`, components: [row], ephemeral: true });
            }
        }


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

        // **REVISED: /list-reward handler (Removed ID from Name)**
        if (command === "list-reward") {
            const achvList = achievementsConfig;
            if (!achvList || achvList.length === 0) {
                return interaction.reply({ content: "⚠️ No achievements configured in config.json.", ephemeral: true });
            }

            const fields = achvList.map(achv => ({
                // Hanya menampilkan Nama Achievement
                name: `🏅 ${achv.name}`, 
                value: achv.description || "— No description —",
                inline: false
            }));

            const embed = new EmbedBuilder()
                .setTitle("📜 List of All Achievements/Rewards")
                .setColor(config.embedColor)
                .setDescription("Berikut adalah daftar semua *achievement* yang dapat diperoleh.")
                .addFields(fields.slice(0, 25)) // Max 25 fields per embed
                .setFooter({ text: `Total ${achvList.length} achievements.` });

            return interaction.reply({ embeds: [embed] });
        }


        if (command === "leaderboard") {

            const limit = 10;
            let page = interaction.options.getInteger("page") || 1;
            let type = interaction.options.getString("type") || 'xp'; 

            const sortField = type === 'expo' ? 'expeditions' : 'xp';
            const sortTitle = type === 'expo' ? 'Expedition' : 'XP';

            const totalUsers = await User.countDocuments();
            const totalPages = Math.max(1, Math.ceil(totalUsers / limit));
            if (page < 1) page = 1;
            if (page > totalPages) page = totalPages;

            const users = await User.find()
                .sort({ [sortField]: -1, robloxId: 1 }) 
                .skip((page - 1) * limit)
                .limit(limit);

            let desc = "";
            let rank = (page - 1) * limit + 1;
            for (const u of users) {
                const value = u[sortField] || 0; 
                desc += `**#${rank}** - **${u.robloxUsername}** → ${value} ${sortTitle}\n`;
                rank++;
            }

            const buttonRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`lb_prev_${type}_${page}`).setLabel("⬅️ Prev").setStyle(ButtonStyle.Primary).setDisabled(page === 1),
                new ButtonBuilder().setCustomId(`lb_next_${type}_${page}`).setLabel("Next ➡️").setStyle(ButtonStyle.Primary).setDisabled(page === totalPages)
            );

            const switchRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`lb_switch_${type === 'xp' ? 'expo' : 'xp'}_${page}`).setLabel(`Switch to ${type === 'xp' ? 'Expedition' : 'XP'} LB`).setStyle(ButtonStyle.Secondary)
            );

            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle(`🏆 Leaderboard ${sortTitle} (Page ${page}/${totalPages})`)
                        .setColor(config.embedColor)
                        .setDescription(desc || "⚠️ No users found.")
                ],
                components: [buttonRow, switchRow]
            });
        }

        if (command === "debug") {
            const allowed =
                interaction.member.permissions.has(PermissionFlagsBits.Administrator) ||
                interaction.member.roles.cache.some(r => (config.debugManagerRoles || []).includes(r.id));
            if (!allowed) return interaction.reply({ content: "❌ You do not have permission to use this command.", ephemeral: true });

            const mongooseState = { 0: "🔴 Disconnected", 1: "🟢 Connected", 2: "🟡 Connecting", 3: "🟠 Disconnecting" }[mongoose.connection.readyState] || "Unknown";

            const totalUsers = await User.countDocuments();
            const users = await User.find({}, { xp: 1, expeditions: 1 }).lean();
            const totalXP = users.reduce((s, u) => s + (u.xp || 0), 0);
            const totalExpeditions = users.reduce((s, u) => s + (u.expeditions || 0), 0);
            const uptime = Math.floor(process.uptime());
            const h = Math.floor(uptime / 3600);
            const m = Math.floor((uptime % 3600) / 60);
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
