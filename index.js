// index.js
const { Client, GatewayIntentBits, SlashCommandBuilder } = require("discord.js");
const sqlite3 = require("sqlite3").verbose();
const fetch = require("node-fetch");
require("dotenv").config();

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// Database
const db = new sqlite3.Database("./xp.db", (err) => {
    if (err) console.error(err.message);
    db.run("CREATE TABLE IF NOT EXISTS xp (userid TEXT PRIMARY KEY, username TEXT, xp INTEGER)");
});

// Daftar Level
const levels = [
    { name: "Climber", xp: 0 },
    { name: "Beginner", xp: 10 },
    { name: "Amateur", xp: 30 },
    { name: "Intermediate", xp: 60 },
    { name: "Advanced", xp: 110 },
    { name: "Expert", xp: 200 },
    { name: "Elite", xp: 360 },
    { name: "Professional", xp: 600 },
    { name: "Legendary", xp: 850 },
    { name: "Champions", xp: 1000 },
    { name: "Lunaticn", xp: 1500 }
];

// Fungsi cari level dari XP
function getLevel(xp) {
    let current = levels[0];
    for (const level of levels) {
        if (xp >= level.xp) {
            current = level;
        }
    }
    return current;
}

// Cari level berikutnya
function getNextLevel(xp) {
    for (const level of levels) {
        if (xp < level.xp) {
            return level;
        }
    }
    return null; // kalau sudah max level
}

// Progress bar XP
function getProgressBar(xp, length = 10) {
    const currentLevel = getLevel(xp);
    const nextLevel = getNextLevel(xp);

    if (!nextLevel) {
        return `🏆 Max Level (${currentLevel.name})`;
    }

    const needXP = nextLevel.xp - currentLevel.xp;
    const gainedXP = xp - currentLevel.xp;
    const progress = Math.floor((gainedXP / needXP) * length);

    const bar = "█".repeat(progress) + "▒".repeat(length - progress);

    return `[${bar}] ${gainedXP}/${needXP} XP → Next: ${nextLevel.name}`;
}

// Register commands
client.once("ready", async () => {
    console.log(`✅ Logged in as ${client.user.tag}`);

    const commands = [
        new SlashCommandBuilder()
            .setName("xp")
            .setDescription("Tambah/lihat XP Roblox user")
            .addStringOption(option =>
                option.setName("username")
                    .setDescription("Username Roblox")
                    .setRequired(true)
            )
            .addIntegerOption(option =>
                option.setName("amount")
                    .setDescription("Jumlah XP untuk ditambah (opsional)")
                    .setRequired(false)
            ),
        new SlashCommandBuilder()
            .setName("leaderboard")
            .setDescription("Lihat leaderboard XP Roblox")
    ].map(cmd => cmd.toJSON());

    await client.application.commands.set(commands);
});

// Fungsi ambil UserId Roblox dari username
async function getRobloxId(username) {
    const res = await fetch(`https://users.roblox.com/v1/usernames/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usernames: [username] })
    });

    const data = await res.json();
    if (data.data.length > 0) {
        return data.data[0].id;
    } else {
        return null;
    }
}

// Command handler
client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === "xp") {
        const username = interaction.options.getString("username");
        const amount = interaction.options.getInteger("amount") || 0;

        const userId = await getRobloxId(username);
        if (!userId) {
            await interaction.reply(`❌ Username **${username}** tidak ditemukan di Roblox.`);
            return;
        }

        db.get("SELECT * FROM xp WHERE userid = ?", [userId], (err, row) => {
            if (err) return console.error(err);

            if (!row) {
                db.run("INSERT INTO xp (userid, username, xp) VALUES (?, ?, ?)", [userId, username, 0]);
                row = { userid: userId, username: username, xp: 0 };
            }

            let newXP = row.xp;
            if (amount !== 0) {
                newXP += amount;
                db.run("UPDATE xp SET xp = ? WHERE userid = ?", [newXP, userId]);
            }

            const level = getLevel(newXP);
            const progressBar = getProgressBar(newXP);

            interaction.reply(
                `🎮 Roblox User: **${username}** (ID: ${userId})\n⭐ XP: **${newXP}**\n🏅 Level: **${level.name}**\n${progressBar}`
            );
        });
    }

    if (interaction.commandName === "leaderboard") {
        db.all("SELECT username, xp FROM xp ORDER BY xp DESC LIMIT 10", [], (err, rows) => {
            if (err) return console.error(err);

            if (rows.length === 0) {
                interaction.reply("📉 Leaderboard kosong.");
                return;
            }

            let leaderboard = rows.map((row, index) => {
                const level = getLevel(row.xp);
                const progressBar = getProgressBar(row.xp, 5); // biar ringkas di leaderboard
                return `**${index + 1}. ${row.username}** — ⭐ ${row.xp} XP — 🏅 ${level.name}\n${progressBar}`;
            }).join("\n\n");

            interaction.reply({
                content: `🏆 **Leaderboard Roblox XP** 🏆\n\n${leaderboard}`
            });
        });
    }
});

client.login(process.env.TOKEN);
