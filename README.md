# MHESZ KASEP — Backend API

Backend untuk **Create Panel via Web** — MHESZ KASEP Bot.

## 🚀 Deploy ke Render

1. Push repo ini ke GitHub
2. Buka [render.com](https://render.com) → New → Web Service
3. Connect repo ini
4. Setting:
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
5. Isi **Environment Variables** (lihat `.env.example`)
6. Klik **Create Web Service**

## 📡 Endpoints

| Method | Endpoint | Fungsi |
|--------|----------|--------|
| GET | `/` | Health check |
| GET | `/api/health` | Cek status backend |
| GET | `/api/servers` | List server |
| GET | `/api/eggs/:id` | List egg dari server |
| POST | `/api/create-panel` | Bikin panel baru |
| POST | `/api/redeem-voucher` | Kirim instruksi klaim voucher |
| POST | `/api/auth-telegram` | Verify login Telegram |

## 🔐 Environment Variables

## 🌐 Frontend

Web: [anjaymabarr401-svg.github.io/tutorial-mahesz](https://anjaymabarr401-svg.github.io/tutorial-mahesz/)

## 📞 Contact

- Owner: [@maklov1](https://t.me/maklov1)
- Bot: [@CpanelhzzBot](https://t.me/CpanelhzzBot)
