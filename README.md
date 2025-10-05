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
npm install discord.js mongoose dotenv node-fetch
