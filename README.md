# 🎮 Discord Roblox XP Bot

Bot Discord untuk mengelola sistem XP berbasis **Roblox username** dan **MongoDB**.  
Fitur meliputi: pemberian XP, pengecekan rank, dan leaderboard.  

---

## 🚀 Fitur Utama

- **XP Management (`/xp`)**  
  Tambah, kurangi, atau set XP Roblox user (hanya untuk admin atau role tertentu).  

- **Rank System (`/rank`)**  
  Menampilkan XP, level, dan progress Roblox user.  

- **Leaderboard (`/leaderboard`)**  
  Menampilkan top user berdasarkan XP dengan pagination (next/prev).  

- **Leveling**  
  - Level diatur lewat `config.json`  
  - Progress bar berbentuk blok emoji  
  - Level-up announcement otomatis  

---

## 📦 Dependencies

- [discord.js](https://discord.js.org/) v14  
- [mongoose](https://mongoosejs.com/)  
- [dotenv](https://www.npmjs.com/package/dotenv)  
- [node-fetch](https://www.npmjs.com/package/node-fetch)  

Install dengan:

```bash
npm install discord.js mongoose dotenv node-fetch ```

## ⚙️ Setup
1. Buat file .env
TOKEN=DISCORD_BOT_TOKEN
MONGO_URI=mongodb+srv://user:pass@cluster.mongodb.net/dbname

2. Buat file config.json
``{
  "groupId": 1234567,
  "xpManagerRoles": ["ROLE_ID_1", "ROLE_ID_2"],
  "xpLogChannelId": "LOG_CHANNEL_ID",
  "levels": [
    { "name": "Beginner", "xp": 0 },
    { "name": "Novice", "xp": 100 },
    { "name": "Intermediate", "xp": 250 },
    { "name": "Expert", "xp": 500 },
    { "name": "Master", "xp": 1000 }
  ]
}``

## 📜 Slash Commands
🔹 /xp <add|remove|set> <username> <amount>

Tambah, kurangi, atau set jumlah XP user.

Hanya bisa digunakan oleh Admin atau role dengan akses.

🔹 /rank <username>

Menampilkan profil Roblox user:

XP

Level

Progress bar

XP needed untuk level selanjutnya

🔹 /leaderboard

Menampilkan Top 10 XP Users dengan pagination tombol ⬅️ ➡️.

## 🗄 Database (MongoDB)

Schema User:

{
  robloxId: String,       // ID Roblox
  robloxUsername: String, // Username Roblox
  xp: Number              // Jumlah XP
}

## 📊 Alur Bot

Admin/member dengan role khusus jalankan /xp

Bot validasi user Roblox & cek apakah ada di group Roblox

XP ditambahkan/diubah di MongoDB

Jika naik level → announce level up

Semua aksi dicatat di XP Log Channel
