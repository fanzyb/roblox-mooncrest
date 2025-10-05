import { REST, Routes, SlashCommandBuilder } from "discord.js";
import dotenv from "dotenv";

dotenv.config();

const commands = [

  // --- /xp ---
  new SlashCommandBuilder()
    .setName("xp")
    .setDescription("Manage XP for Roblox users")
    .addSubcommand(sub =>
      sub.setName("add")
        .setDescription("Add XP to a Roblox user")
        .addStringOption(opt =>
          opt.setName("username")
            .setDescription("Roblox username")
            .setRequired(true))
        .addIntegerOption(opt =>
          opt.setName("amount")
            .setDescription("XP amount to add")
            .setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName("remove")
        .setDescription("Remove XP from a Roblox user")
        .addStringOption(opt =>
          opt.setName("username")
            .setDescription("Roblox username")
            .setRequired(true))
        .addIntegerOption(opt =>
          opt.setName("amount")
            .setDescription("XP amount to remove")
            .setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName("set")
        .setDescription("Set XP of a Roblox user")
        .addStringOption(opt =>
          opt.setName("username")
            .setDescription("Roblox username")
            .setRequired(true))
        .addIntegerOption(opt =>
          opt.setName("amount")
            .setDescription("XP value to set")
            .setRequired(true))
    ),

  // --- /rank ---
  new SlashCommandBuilder()
    .setName("rank")
    .setDescription("Show rank & progress of a Roblox user")
    .addStringOption(opt =>
      opt.setName("username")
        .setDescription("Roblox username")
        .setRequired(true)
    ),

  // --- /leaderboard ---
  new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("Show Roblox XP leaderboard")
    .addIntegerOption(opt =>
      opt.setName("page")
        .setDescription("Page number of leaderboard")
        .setRequired(false)
    )
]
.map(command => command.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

(async () => {
  try {
    console.log("⏳ Refreshing application (/) commands...");

    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands }
    );

    console.log("✅ Successfully reloaded application (/) commands.");
  } catch (error) {
    console.error(error);
  }
})();
