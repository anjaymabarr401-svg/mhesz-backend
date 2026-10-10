// ═══════════════════════════════════════════════════════
//  MHESZ KASEP — BACKEND API
// ═══════════════════════════════════════════════════════

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// ═══ MIDDLEWARE ═══
app.use(express.json({ limit: '1mb' }));
app.use(cors({ origin: '*', methods: ['GET', 'POST'] }));

// ═══ RATE LIMIT ═══
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { success: false, error: 'Terlalu banyak request. Coba lagi nanti.' },
});
app.use('/api/', limiter);

// ═══ ENV ═══
const PLTA       = process.env.PLTA;
const PLTC       = process.env.PLTC;
const DOMAIN     = process.env.DOMAIN;
const DOMAIN2    = process.env.DOMAIN2 || DOMAIN;
const PLTA2      = process.env.PLTA2 || PLTA;
const PLTC2      = process.env.PLTC2 || PLTC;
const BOT_TOKEN  = process.env.BOT_TOKEN;
const BOT_URL    = process.env.BOT_URL || 'https://t.me/CpanelhzzBot';

const SERVERS = {
  1: { label: 'SERVER 1', domain: DOMAIN,  plta: PLTA,  pltc: PLTC },
  2: { label: 'SERVER 2', domain: DOMAIN2, plta: PLTA2, pltc: PLTC2 },
};

// ═══ HELPERS ═══
function appHeaders(srv) {
  return {
    'Accept': 'Application/vnd.pterodactyl.v1+json',
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${srv.plta}`,
    'User-Agent': 'MHESZ-KASEP-Backend/1.0',
  };
}

async function sendTelegramDM(chatId, text, keyboard = null) {
  if (!BOT_TOKEN) return false;
  try {
    const body = { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true };
    if (keyboard) body.reply_markup = keyboard;
    const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const d = await r.json();
    return d.ok === true;
  } catch (e) { console.log('[telegram]', e.message); return false; }
}

function generateGaransi() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let kode = 'GRN-';
  for (let i = 0; i < 8; i++) kode += chars[Math.floor(Math.random() * chars.length)];
  return kode;
}

async function getAllEggs(srv) {
  try {
    const r1 = await fetch(`${srv.domain}/api/application/nests`, { headers: appHeaders(srv) });
    const d1 = await r1.json();
    if (!d1.data) return [];
    const allEggs = [];
    for (const nest of d1.data) {
      const r2 = await fetch(`${srv.domain}/api/application/nests/${nest.attributes.id}/eggs?include=variables`, {
        headers: appHeaders(srv),
      });
      const d2 = await r2.json();
      if (!d2.data) continue;
      for (const egg of d2.data) {
        const env = {};
        const vars = egg.attributes.relationships?.variables?.data || [];
        for (const v of vars) env[v.attributes.env_variable] = String(v.attributes.default_value ?? '');
        allEggs.push({
          id: egg.attributes.id,
          name: egg.attributes.name,
          dockerImage: egg.attributes.docker_image,
          startup: egg.attributes.startup,
          environment: env,
        });
      }
    }
    return allEggs;
  } catch (e) { console.log('[getAllEggs]', e.message); return []; }
}

async function getFirstNode(srv) {
  try {
    const r = await fetch(`${srv.domain}/api/application/nodes`, { headers: appHeaders(srv) });
    const d = await r.json();
    if (!d.data || !d.data.length) return null;
    const available = d.data.filter(n => n.attributes.maintenance_mode !== true);
    return available.length ? available[0].attributes.id : null;
  } catch { return null; }
}

async function usernameExists(srv, username) {
  try {
    const r = await fetch(`${srv.domain}/api/application/users?filter[username]=${username}`, { headers: appHeaders(srv) });
    const d = await r.json();
    return d.data && d.data.length > 0;
  } catch { return false; }
}

// ═══ ROUTES ═══
app.get('/', (req, res) => {
  res.json({ success: true, message: 'MHESZ KASEP Backend aktif 🚀', version: '1.0.0' });
});

app.get('/api/health', (req, res) => {
  res.json({ success: true, uptime: process.uptime(), time: new Date().toISOString() });
});

app.get('/api/servers', (req, res) => {
  res.json({
    success: true,
    servers: Object.entries(SERVERS).map(([id, srv]) => ({
      id: parseInt(id), label: srv.label, domain: srv.domain,
    })),
  });
});

app.get('/api/eggs/:serverId', async (req, res) => {
  const srv = SERVERS[req.params.serverId];
  if (!srv) return res.status(400).json({ success: false, error: 'Server invalid' });
  const eggs = await getAllEggs(srv);
  res.json({ success: true, count: eggs.length, eggs: eggs.map(e => ({ id: e.id, name: e.name })) });
});

// ═══ POST: CREATE PANEL ═══
app.post('/api/create-panel', async (req, res) => {
  try {
    const { userId, username, ram, serverId, eggKey } = req.body;

    if (!userId) return res.status(400).json({ success: false, error: 'userId wajib' });
    if (!username || username.length < 3 || username.length > 15) {
      return res.status(400).json({ success: false, error: 'Nama panel harus 3-15 karakter' });
    }

    const cleanName = String(username).replace(/[^a-z0-9_-]/g, '').toLowerCase();
    if (cleanName.length < 3) return res.status(400).json({ success: false, error: 'Nama panel invalid' });

    const srv = SERVERS[serverId] || SERVERS[1];
    const ramMB = parseInt(ram) || 0;

    if (await usernameExists(srv, cleanName)) {
      return res.status(409).json({ success: false, error: `Username "${cleanName}" udah dipakai. Coba nama lain.` });
    }

    const nodeId = await getFirstNode(srv);
    if (!nodeId) return res.status(503).json({ success: false, error: `Server ${srv.label} gak ada node available.` });

    const eggs = await getAllEggs(srv);
    if (!eggs.length) return res.status(503).json({ success: false, error: `Gagal ambil egg dari ${srv.label}.` });

    let chosenEgg = eggs.find(e => {
      const n = e.name.toLowerCase();
      if (eggKey === 'node18') return /node\.?js\s*v?18/i.test(n) || /node\.?js\s*v?1\b/i.test(n);
      if (eggKey === 'node20') return /node\.?js\s*v?20/i.test(n) || /node\.?js\s*v?2\b/i.test(n);
      if (eggKey === 'python') return /python/i.test(n);
      if (eggKey === 'java')   return /java/i.test(n);
      if (eggKey === 'minecraft') return /minecraft/i.test(n);
      return false;
    });

    if (!chosenEgg) chosenEgg = eggs.find(e => /node/i.test(e.name)) || eggs[0];

    const email = `${cleanName}@mheszkasep.local`;
    const password = `${cleanName}001`;

    const r1 = await fetch(`${srv.domain}/api/application/users`, {
      method: 'POST',
      headers: appHeaders(srv),
      body: JSON.stringify({
        email, username: cleanName,
        first_name: cleanName, last_name: cleanName,
        language: 'en', password,
      }),
    });
    const d1 = await r1.json();
    if (d1.errors) return res.status(400).json({ success: false, error: d1.errors[0].detail });
    const user = d1.attributes;

    const finalEnv = { ...(chosenEgg.environment || {}) };
    if (finalEnv.CMD_RUN !== undefined && !finalEnv.CMD_RUN) finalEnv.CMD_RUN = 'node index.js';
    if (finalEnv.MAIN_FILE !== undefined && !finalEnv.MAIN_FILE) finalEnv.MAIN_FILE = 'index.js';
    if (finalEnv.INST === '') finalEnv.INST = 'npm';

    const r2 = await fetch(`${srv.domain}/api/application/servers`, {
      method: 'POST',
      headers: appHeaders(srv),
      body: JSON.stringify({
        name: cleanName,
        description: `🖥️ WEB PANEL - MHESZ KASEP - ${chosenEgg.name}`,
        user: user.id,
        egg: parseInt(chosenEgg.id),
        docker_image: chosenEgg.dockerImage || 'ghcr.io/parkervcp/yolks:nodejs_18',
        startup: chosenEgg.startup || 'node index.js',
        environment: finalEnv,
        limits: { memory: ramMB || 0, swap: 0, disk: ramMB || 0, io: 500, cpu: 0 },
        feature_limits: { databases: 5, backups: 5, allocations: 1 },
        deploy: { locations: [nodeId], dedicated_ip: false, port_range: [] },
      }),
    });
    const d2 = await r2.json();
    if (d2.errors) {
      try { await fetch(`${srv.domain}/api/application/users/${user.id}`, { method: 'DELETE', headers: appHeaders(srv) }); } catch {}
      return res.status(400).json({ success: false, error: d2.errors[0].detail });
    }
    const server = d2.attributes;

    const garansiKode = generateGaransi();
    const ramText = ramMB ? `${ramMB / 1024} GB` : 'UNLIMITED';

    const dmText = `✅ <b>PANEL BERHASIL DIBUAT!</b>

<blockquote>📛 Nama: <code>${cleanName}</code>
💾 RAM: <b>${ramText}</b>
🖥️ Server: <b>${srv.label}</b>
📦 Egg: <b>${chosenEgg.name}</b>
🌐 Dari: <b>WEB</b></blockquote>

<b>🔐 DATA LOGIN:</b>
├ 👤 Username: <code>${user.username}</code>
├ 🔑 Password: <code>${password}</code>
└ 🔗 Panel: <a href="${srv.domain}">${srv.domain}</a>

<b>🎫 KODE GARANSI:</b>
<code>${garansiKode}</code>

📞 Butuh bantuan? @maklov1`;

    const dmSent = await sendTelegramDM(userId, dmText, {
      inline_keyboard: [
        [{ text: '📋 Copy Password', copy_text: { text: password } }, { text: '📋 Copy Username', copy_text: { text: user.username } }],
        [{ text: '🔐 Login Panel', url: srv.domain }],
      ],
    });

    res.json({
      success: true,
      message: 'Panel berhasil dibuat!',
      dmSent,
      data: {
        username: user.username, password, panelUrl: srv.domain,
        serverLabel: srv.label, eggName: chosenEgg.name, ram: ramText,
        garansiKode, serverId: server.id, identifier: server.identifier,
      },
    });

  } catch (e) {
    console.log('[create-panel]', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ═══ POST: REDEEM VOUCHER ═══
app.post('/api/redeem-voucher', async (req, res) => {
  try {
    const { userId, kode } = req.body;
    if (!userId || !kode) return res.status(400).json({ success: false, error: 'userId & kode wajib' });

    const dmText = `🎫 <b>KLAIM VOUCHER</b>

Kode voucher lu: <code>${String(kode).toUpperCase()}</code>

<b>Klik tombol di bawah</b> buat klaim di bot:`;

    const dmSent = await sendTelegramDM(userId, dmText, {
      inline_keyboard: [[{ text: '🎫 Klaim di Bot', url: `${BOT_URL}?start=vcr_${encodeURIComponent(kode)}` }]],
    });

    res.json({ success: true, message: 'Instruksi klaim voucher terkirim ke DM', dmSent });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ═══ POST: AUTH TELEGRAM ═══
app.post('/api/auth-telegram', (req, res) => {
  try {
    const { hash, ...data } = req.body;
    if (!hash || !data.id) return res.status(400).json({ success: false, error: 'Data login tidak lengkap' });

    const secret = crypto.createHash('sha256').update(BOT_TOKEN).digest();
    const checkHash = crypto.createHmac('sha256', secret)
      .update(Object.keys(data).sort().map(k => `${k}=${data[k]}`).join('\n'))
      .digest('hex');

    if (checkHash !== hash) return res.status(401).json({ success: false, error: 'Signature tidak valid' });

    const authDate = parseInt(data.auth_date) * 1000;
    if (Date.now() - authDate > 24 * 60 * 60 * 1000) {
      return res.status(401).json({ success: false, error: 'Session expired, login ulang' });
    }

    res.json({
      success: true,
      user: {
        id: String(data.id),
        firstName: data.first_name || '',
        lastName: data.last_name || '',
        username: data.username || '',
        photoUrl: data.photo_url || '',
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ═══ 404 ═══
app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Endpoint gak ketemu' });
});

// ═══ START ═══
app.listen(PORT, () => {
  console.log('═══════════════════════════════════════════');
  console.log('🚀 MHESZ KASEP BACKEND');
  console.log('═══════════════════════════════════════════');
  console.log(`📡 Port: ${PORT}`);
  console.log(`🌐 Domain: ${DOMAIN || '(belum diset)'}`);
  console.log(`🤖 Bot: ${BOT_TOKEN ? '✅ Aktif' : '❌ Belum diset'}`);
  console.log('═══════════════════════════════════════════');
});
