import WebSocket from 'ws';
import { GAME_LIBRARY, HOUSE_NAMES, BADGE_FLAGS, BADGE_NAMES, BADGE_CATALOG, BADGE_ACTIONS } from './games.mjs';

const API = 'https://discord.com/api/v9';
const GATEWAY_URL = 'wss://gateway.discord.gg/?v=9&encoding=json';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) discord/1.0.9164 Chrome/124.0.6367.243 Electron/30.4.0 Safari/537.36';

const SUPER_PROPS = Buffer.from(JSON.stringify({
  os: 'Windows', browser: 'Discord Client', release_channel: 'stable',
  client_version: '1.0.9164', os_version: '10.0.22631', os_arch: 'x64',
  app_arch: 'x64', system_locale: 'en-US',
  client_build_number: 252528, client_event_source: null,
})).toString('base64');

// ── REST ───────────────────────────────────────────────────────

function hdrs(token, skipSuperProps = false) {
  const h = {
    Authorization: token, 'Content-Type': 'application/json',
    'User-Agent': UA,
  };
  if (!skipSuperProps) h['X-Super-Properties'] = SUPER_PROPS;
  return h;
}

// ── REST with auto rate-limit retry ───────────────────────────
async function _request(method, token, path, body) {
  // Quest endpoints return empty with X-Super-Properties — skip it
  const skipSP = path.startsWith('/quests');
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const opts = { method, headers: hdrs(token, skipSP) };
      if (body !== undefined) opts.body = JSON.stringify(body);
      const r = await fetch(`${API}${path}`, opts);

      // rate limited — wait and retry
      if (r.status === 429) {
        const data = await r.json().catch(() => ({}));
        const wait = (data.retry_after || 2) * 1000;
        await new Promise(res => setTimeout(res, Math.min(wait + 500, 30000)));
        continue;
      }

      if (r.status === 204) return { success: true };
      if (!r.ok) return { error: r.status, message: await r.text().catch(() => '') };
      const t = await r.text();
      return t ? JSON.parse(t) : { success: true };
    } catch (e) {
      if (attempt === 2) return { error: 0, message: e.message };
      await new Promise(res => setTimeout(res, 2000));
    }
  }
  return { error: 0, message: 'max retries' };
}

async function GET(token, path) { return _request('GET', token, path); }
async function POST(token, path, body = {}) { return _request('POST', token, path, body); }
async function PUT(token, path, body = {}) { return _request('PUT', token, path, body); }
async function DEL(token, path) {
  try {
    const r = await fetch(`${API}${path}`, { method: 'DELETE', headers: hdrs(token) });
    if (r.status === 429) {
      const data = await r.json().catch(() => ({}));
      await new Promise(res => setTimeout(res, (data.retry_after || 2) * 1000 + 500));
      const r2 = await fetch(`${API}${path}`, { method: 'DELETE', headers: hdrs(token) });
      if (r2.status === 204 || r2.ok) return { success: true };
      return { error: r2.status, message: await r2.text().catch(() => '') };
    }
    if (r.status === 204 || r.ok) return { success: true };
    return { error: r.status, message: await r.text().catch(() => '') };
  } catch (e) { return { error: 0, message: e.message }; }
}

// ── Gateway ────────────────────────────────────────────────────

class Gateway {
  constructor(token) {
    this.token = token; this.ws = null; this.seq = null;
    this.sessionId = null; this.heartbeatMs = 41250;
    this.heartbeatTimer = null; this.connected = false;
    this.currentGame = null; this._resolve = null; this._reject = null;
    this._dead = false;
    this.readyData = null; // full READY payload — contains quests, guilds, user settings etc
  }

  connect() {
    return new Promise((resolve, reject) => {
      this._resolve = resolve; this._reject = reject;
      this._open();
    });
  }

  _open() {
    this.ws = new WebSocket(GATEWAY_URL, { headers: { 'User-Agent': UA } });
    this.ws.on('message', raw => this._onMsg(JSON.parse(raw.toString())));
    this.ws.on('close', () => { this.connected = false; this._stopHB(); if (!this._dead) setTimeout(() => this._reconnect(), 5000); });
    this.ws.on('error', err => { if (this._reject) { this._reject(err); this._reject = null; } });
  }

  _onMsg(m) {
    if (m.s) this.seq = m.s;
    if (m.op === 10) { this.heartbeatMs = m.d.heartbeat_interval; this._startHB(); this._identify(); }
    if (m.op === 11) { /* ack */ }
    if (m.op === 1) this._hb();
    if (m.op === 7) this.ws.close();
    if (m.op === 9) { this.sessionId = null; this.seq = null; this._identify(); }
    if (m.op === 0 && m.t === 'READY') {
      this.sessionId = m.d.session_id; this.connected = true;
      this.readyData = m.d; // save full READY payload for quests etc
      if (this._resolve) { this._resolve(m.d.user); this._resolve = null; }
    }
  }

  _identify() {
    // full Desktop client identify — must match real client for game detection badges
    this._send(2, {
      token: this.token,
      capabilities: 30717,
      properties: {
        os: 'Windows',
        browser: 'Discord Client',
        device: '',
        system_locale: 'en-US',
        browser_user_agent: UA,
        browser_version: '30.4.0',
        os_version: '10.0.22631',
        referrer: '',
        referring_domain: '',
        referrer_current: '',
        referring_domain_current: '',
        release_channel: 'stable',
        client_build_number: 252528,
        client_event_source: null,
        design_id: 0,
      },
      presence: {
        status: this._userStatus || 'online',
        since: 0,
        activities: [],
        afk: false,
      },
      compress: false,
      client_state: {
        guild_versions: {},
        highest_last_message_id: '0',
        read_state_version: 0,
        user_guild_settings_version: -1,
        user_settings_version: -1,
        private_channels_version: '0',
        api_code_version: 0,
      },
    });
  }

  _send(op, d) { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ op, d })); }
  _hb() { this._send(1, this.seq); }
  _startHB() { this._stopHB(); this.heartbeatTimer = setInterval(() => this._hb(), this.heartbeatMs); }
  _stopHB() { if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; } }

  _reconnect() {
    if (this._dead) return;
    try {
      this.ws = new WebSocket(GATEWAY_URL, { headers: { 'User-Agent': UA } });
      this.ws.on('message', raw => {
        const m = JSON.parse(raw.toString());
        if (m.op === 10) {
          this.heartbeatMs = m.d.heartbeat_interval; this._startHB();
          if (this.sessionId && this.seq) this._send(6, { token: this.token, session_id: this.sessionId, seq: this.seq });
          else this._identify();
        } else this._onMsg(m);
      });
      this.ws.on('close', () => { this.connected = false; this._stopHB(); if (!this._dead) setTimeout(() => this._reconnect(), 10000); });
      this.ws.on('error', () => {});
    } catch { setTimeout(() => this._reconnect(), 10000); }
  }

  setActivity(game, { streaming = false, type = 0, status = null } = {}) {
    const activities = [];
    if (game) {
      const now = Date.now();
      // Use game.type if defined (e.g. Netflix=3/Watching, Spotify=2/Listening)
      const actType = streaming ? 1 : (game.type || type);
      const a = {
        name: game.name,
        type: actType,
        timestamps: { start: now },
        created_at: now, // real client sends this for game detection
      };
      if (game.id) a.application_id = game.id;
      if (streaming || actType === 1) {
        a.url = 'https://www.twitch.tv/discord';
        a.state = 'Playing ' + game.name;
        a.details = 'Streaming';
      }
      activities.push(a);
      this.currentGame = game;
    } else { this.currentGame = null; }
    const st = status || this._userStatus || 'online';
    this._send(3, { since: st === 'idle' ? Date.now() : 0, activities, status: st, afk: st === 'idle' });
  }

  setMultiActivity(activities, status = null) {
    const st = status || this._userStatus || 'online';
    this._send(3, { since: st === 'idle' ? Date.now() : 0, activities, status: st, afk: st === 'idle' });
  }

  setStatus(status) {
    // online, idle, dnd, invisible
    this._userStatus = status;
    // re-send current presence with new status
    const activities = [];
    if (this.currentGame) {
      activities.push({ name: this.currentGame.name, type: 0, timestamps: { start: Date.now() } });
      if (this.currentGame.id) activities[0].application_id = this.currentGame.id;
    }
    this._send(3, { since: status === 'idle' ? Date.now() : 0, activities, status, afk: status === 'idle' });
  }

  voiceConnect(guildId, channelId, selfMute = true, selfDeaf = true) {
    this._send(4, { guild_id: guildId, channel_id: channelId, self_mute: selfMute, self_deaf: selfDeaf });
  }

  voiceDisconnect(guildId) {
    this._send(4, { guild_id: guildId, channel_id: null, self_mute: false, self_deaf: false });
  }

  // Start Go Live stream in a voice channel
  async startStream(guildId, channelId) {
    // request stream key via op 18 (STREAM_CREATE)
    this._send(18, {
      type: 'guild',
      guild_id: guildId,
      channel_id: channelId,
      preferred_region: 'us-central',
    });
  }

  // Stop Go Live stream
  async stopStream(guildId, channelId) {
    // op 19 (STREAM_DELETE)
    this._send(19, {
      stream_key: `guild:${guildId}:${channelId}:${this.readyData?.user?.id || ''}`,
    });
  }

  clearActivity() { this.currentGame = null; this.setActivity(null); }

  disconnect() {
    this._dead = true; this._stopHB();
    try { this.ws?.close(); } catch {}
  }
}

// ── DiscordAccount ─────────────────────────────────────────────

export class DiscordAccount {
  constructor(token) {
    this.token = token;
    this.gateway = new Gateway(token);
    this.userInfo = null;
    this.connected = false;
    this.logs = [];
    this._questRunners = new Map(); // questId -> { abort, promise }
    this._sessionTimer = null;
    this._voiceTimers = new Map(); // guildId -> timer
    this._voiceActive = new Map(); // guildId -> { channelId, ... }
    this._questCache = null;
    this._questCacheTime = 0;
  }

  _log(msg, level = 'info') {
    const time = new Date().toLocaleTimeString('en-GB', { hour12: false });
    // suppress duplicate warnings (same msg within 30 seconds)
    if (level === 'warn' && this.logs.length > 0) {
      const last = this.logs[this.logs.length - 1];
      if (last.msg === msg && last.level === 'warn') return; // skip exact duplicate
    }
    this.logs.push({ time, level, msg });
    if (this.logs.length > 500) this.logs = this.logs.slice(-500);
  }

  async connect() {
    const me = await GET(this.token, '/users/@me');
    if (me.error) throw new Error(`توكن غير صالح (${me.error})`);
    this.userInfo = { id: me.id, username: me.username, global_name: me.global_name, avatar: me.avatar, discriminator: me.discriminator, public_flags: me.public_flags || 0 };
    try { await this.gateway.connect(); } catch (e) { throw new Error('فشل Gateway: ' + e.message); }
    this.connected = true;
    this._log(`✅ متصل: ${me.username} (${me.id})`);
    return this.userInfo;
  }

  async disconnect() {
    await this.stopAll();
    // disconnect all voice
    for (const gid of this._voiceActive.keys()) this.gateway.voiceDisconnect(gid);
    this._voiceActive.clear();
    for (const t of this._voiceTimers.values()) clearInterval(t);
    this._voiceTimers.clear();
    this.gateway.disconnect();
    this.connected = false;
    this._log('🔌 تم قطع الاتصال');
  }

  // ══════════════════════════════════════════════════════════════
  // QUESTS
  // ══════════════════════════════════════════════════════════════

  async getQuests() {
    // cache quests for 30 seconds to avoid spamming Discord API
    if (this._questCache && Date.now() - this._questCacheTime < 30000) {
      return this._questCache;
    }

    let list = [];

    // Always use REST API — most reliable for quest data
    try {
      const raw = await GET(this.token, '/quests/@me');
      if (!raw?.error) {
        if (raw?.quests && Array.isArray(raw.quests)) {
          list = raw.quests;
          this._log(`✅ جلب ${list.length} مهمة من /quests/@me`);
        } else if (Array.isArray(raw)) {
          list = raw;
          this._log(`✅ جلب ${list.length} مهمة`);
        }
      }
    } catch {}

    // Fallback: try other endpoints
    if (list.length === 0) {
      for (const ep of ['/users/@me/quests', '/quests']) {
        try {
          const raw = await GET(this.token, ep);
          if (raw?.error) continue;
          let items = [];
          if (Array.isArray(raw)) items = raw;
          else if (raw?.quests && Array.isArray(raw.quests)) items = raw.quests;
          if (items.length > 0) { list = items; this._log(`✅ جلب ${items.length} مهمة من ${ep}`); break; }
        } catch {}
      }
    }

    if (list.length === 0) {
      this._log('⚠ لا توجد مهام متاحة حاليا لحسابك', 'warn');
    }

    const parsed = list.map(q => this._parseQuest(q));
    const beforeFilter = parsed.length;
    const result = parsed.filter(Boolean);
    if (beforeFilter > 0 && result.length !== beforeFilter) {
      this._log(`⚠ parsed ${beforeFilter} quests, ${beforeFilter - result.length} filtered out (expired/null)`);
    }
    this._questCache = result;
    this._questCacheTime = Date.now();
    return result;
  }

  _parseQuest(q) {
    if (!q) return null;
    const id = q.id || q.quest_id || q.code;
    if (!id) return null;

    const cfg = q.config || q.quest_config || {};
    const msgs = cfg.messages || q.messages || {};
    // v2 format: application is nested object inside config
    const app = cfg.application || {};
    // task config: v1 uses task_config, v2 uses task_config_v2
    const taskV2 = cfg.task_config_v2 || cfg.taskConfig_v2 || {};
    const task = cfg.taskConfig || cfg.task_config || q.task_config || {};
    const target = task.target || {};
    const us = q.user_status || q.userStatus || {};
    const prog = us.progress || {};

    // progress: v2 uses PLAY_ON_DESKTOP or STREAM_ON_DESKTOP keys in progress object
    // target comes from task_config_v2.tasks[key].target
    let done = prog.completed_steps || prog.completedSteps || 0;
    let total = prog.total_steps || prog.totalSteps || 0;
    // v2 format: progress is {PLAY_ON_DESKTOP: {value: 50, ...}}, tasks is {PLAY_ON_DESKTOP: {target: 900, ...}}
    const v2Tasks = taskV2.tasks || {};
    if (typeof prog === 'object' && !done) {
      for (const key of Object.keys(prog)) {
        if (key === 'completed_steps' || key === 'completedSteps' || key === 'total_steps' || key === 'totalSteps') continue;
        const p = prog[key];
        if (p && typeof p === 'object') {
          done = p.value || p.current || 0;
          // get target from task_config_v2.tasks
          const taskDef = v2Tasks[key] || {};
          total = taskDef.target || p.target || p.total || 0;
        }
      }
    }
    if (total === 0) total = 1;
    const pct = Math.min(100, total > 0 ? (done / total) * 100 : 0);

    const enrolled = !!(us.enrolled_at || us.enrolledAt);
    const completed = !!(us.completed_at || us.completedAt);
    const claimed = !!(us.claimed_at || us.claimedAt);

    // filter expired quests
    const expiresAt = cfg.expires_at || q.expires_at;
    if (expiresAt && new Date(expiresAt) < new Date()) return null;

    let status = '⬚ متاح';
    if (claimed) status = '✅ تم الاستلام';
    else if (completed) status = '🎁 جاهز للاستلام';
    else if (enrolled && this._questRunners.has(id)) status = `⚡ يشتغل... ${pct.toFixed(0)}%`;
    else if (enrolled) status = `⏳ مسجل ${pct.toFixed(0)}%`;

    // name: try messages first, then application name
    const name = msgs.quest_name || msgs.questName || msgs.game_title || msgs.gameTitle
      || app.name || cfg.application_name || cfg.applicationName || q.name || q.title || 'Quest';

    // app id from application object or config
    const appId = String(app.id || cfg.application_id || cfg.applicationId || q.application_id || '');

    // determine task type from v2 tasks object or array
    let taskType = task.type || q.type || 'PLAY_ON_DESKTOP';
    if (taskV2.tasks) {
      if (typeof taskV2.tasks === 'object' && !Array.isArray(taskV2.tasks)) {
        // v2: tasks is an object keyed by type e.g. {PLAY_ON_DESKTOP: {...}}
        const firstKey = Object.keys(taskV2.tasks)[0];
        if (firstKey) taskType = firstKey;
      } else if (Array.isArray(taskV2.tasks) && taskV2.tasks.length > 0) {
        taskType = taskV2.tasks[0].type || taskType;
      }
    }

    return {
      id,
      name,
      game: app.name || cfg.application_name || cfg.applicationName || q.application_name || '',
      app_id: appId,
      type: taskType,
      duration_min: target.value || task.streamDurationRequirementMinutes
        || task.stream_duration_requirement_minutes || task.duration_minutes || 15,
      progress: pct, enrolled, completed, claimed, status,
      is_active: !completed && !claimed,
      running: this._questRunners.has(id),
      reward_name: msgs.reward_name || msgs.rewardName || '',
      reward_description: msgs.reward_description || msgs.rewardDescription || '',
      publisher: msgs.game_publisher || app.publisher || '',
      expires_at: expiresAt || null,
    };
  }

  // run SELECTED quests in parallel
  async runQuests(questIds, turbo = false) {
    const quests = await this.getQuests();
    const toRun = quests.filter(q => questIds.includes(q.id) && q.is_active && !q.claimed);
    if (toRun.length === 0) { this._log('⚠ لا توجد مهام قابلة للتشغيل', 'warn'); return; }
    this._log(`🚀 تشغيل ${toRun.length} مهمة ${turbo ? '(توربو ⚡)' : ''}`);
    for (const q of toRun) {
      if (this._questRunners.has(q.id)) continue;
      const ctrl = { aborted: false };
      const promise = this._runQuest(q, ctrl, turbo);
      this._questRunners.set(q.id, { ctrl, promise });
      // stagger enrollment to avoid rate limits
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  // run ALL quests (only non-expired, active ones)
  async autoCompleteAll(turbo = false) {
    const quests = await this.getQuests();
    const now = Date.now();
    const ids = quests.filter(q => {
      if (!q.is_active || q.claimed) return false;
      // double-check expiry
      if (q.expires_at && new Date(q.expires_at).getTime() < now) return false;
      return true;
    }).map(q => q.id);
    if (ids.length === 0) { this._log('⚠ لا توجد مهام نشطة وغير منتهية', 'warn'); return; }
    this._log(`🎯 ${ids.length} مهمة نشطة من أصل ${quests.length}`);
    await this.runQuests(ids, turbo);
  }

  async _runQuest(quest, ctrl, turbo = false) {
    try {
      // enroll
      if (!quest.enrolled) {
        this._log(`📝 تسجيل: ${quest.name}`);
        const er = await POST(this.token, `/quests/${quest.id}/enroll`);
        if (er.error) { this._log(`❌ فشل تسجيل ${quest.name}: ${er.error}`, 'error'); return; }
        this._log(`✅ مسجل: ${quest.name}`);
        await sleep(1500);
      }

      // simulate
      const game = this._findGame(quest);
      const isStream = quest.type === 'STREAM_ON_DESKTOP';
      const durationMs = turbo ? 30_000 : quest.duration_min * 60 * 1000;
      const heartbeatSec = turbo ? 5 : 20;

      this._log(`${isStream ? '📡' : '🎮'} ${quest.name}: ${game.name} ${turbo ? '(توربو)' : `(${quest.duration_min} د)`}`);

      // set activity for THIS quest
      this.gateway.setActivity(game, { streaming: isStream });

      let elapsed = 0;
      while (elapsed < durationMs && !ctrl.aborted) {
        await sleep(heartbeatSec * 1000);
        if (ctrl.aborted) break;
        elapsed += heartbeatSec * 1000;

        // quest heartbeat — the key to progress
        const hb = await POST(this.token, `/quests/${quest.id}/heartbeat`, {
          stream_key: isStream ? `discord:${this.userInfo.id}` : undefined,
        });

        // also try video progress endpoint for watch quests
        if (quest.type === 'WATCH_VIDEO' || quest.type === 'WATCH_STREAM') {
          await POST(this.token, `/quests/${quest.id}/video-progress`, { timestamp: elapsed / 1000 });
        }

        const pct = Math.min(100, (elapsed / durationMs) * 100);
        if (elapsed % (turbo ? 10_000 : 60_000) < heartbeatSec * 1000) {
          this._log(`⏳ ${quest.name}: ${pct.toFixed(0)}%`);
        }

        // check if completed early
        if (pct >= 100 || turbo) {
          const check = await GET(this.token, `/quests/${quest.id}`);
          if (check?.user_status?.completed_at) {
            this._log(`✅ اكتمل: ${quest.name}`);
            break;
          }
        }
      }

      this.gateway.clearActivity();
      if (ctrl.aborted) { this._log(`⏹ ألغي: ${quest.name}`); return; }
      await sleep(2000);

      // claim
      this._log(`🎁 استلام: ${quest.name}`);
      const cl = await POST(this.token, `/quests/${quest.id}/claim-reward`);
      if (cl.error) this._log(`⚠ خطأ استلام ${quest.name}: ${cl.error} — ${cl.message || ''}`, 'warn');
      else this._log(`✅ تم استلام مكافأة: ${quest.name} 🎉`);

    } catch (e) {
      this._log(`❌ ${quest.name}: ${e.message}`, 'error');
    } finally {
      this._questRunners.delete(quest.id);
    }
  }

  async stopQuest(questId) {
    const r = this._questRunners.get(questId);
    if (r) { r.ctrl.aborted = true; this._questRunners.delete(questId); }
  }

  async stopAll() {
    for (const [id, r] of this._questRunners) r.ctrl.aborted = true;
    this._questRunners.clear();
    this.gateway.clearActivity();
    if (this._sessionTimer) clearTimeout(this._sessionTimer);
    this._log('⏹ تم إيقاف الكل');
  }

  _findGame(quest) {
    if (quest.app_id) {
      const m = GAME_LIBRARY.find(g => g.id === quest.app_id);
      if (m) return m;
      return { name: quest.game || quest.name, id: quest.app_id };
    }
    return GAME_LIBRARY[Math.floor(Math.random() * GAME_LIBRARY.length)];
  }

  // ══════════════════════════════════════════════════════════════
  // HYPESQUAD
  // ══════════════════════════════════════════════════════════════

  async setHypeSquad(houseId) {
    houseId = Number(houseId);
    if (![1, 2, 3].includes(houseId)) return { success: false, error: 'Invalid house' };
    const r = await POST(this.token, '/hypesquad/online', { house_id: houseId });
    const ok = r.success || !r.error;
    this._log(ok
      ? `🛡 شارة HypeSquad ${HOUSE_NAMES[houseId]} تفعلت! — شيك بروفايلك بالديسكورد`
      : `❌ فشل HypeSquad: ${JSON.stringify(r)}`, ok ? 'info' : 'error');
    return { success: ok, house: HOUSE_NAMES[houseId], detail: r };
  }

  async removeHypeSquad() {
    const r = await DEL(this.token, '/hypesquad/online');
    this._log(!r.error ? '🛡 تم إزالة HypeSquad' : `❌ ${r.error}`, !r.error ? 'info' : 'error');
    return { success: !r.error, detail: r };
  }

  // ══════════════════════════════════════════════════════════════
  // ACTIVE DEVELOPER BADGE
  // ══════════════════════════════════════════════════════════════

  async getActiveDeveloper() {
    // check if user has the badge already
    const flags = this.userInfo.public_flags || 0;
    const has = !!(flags & BADGE_FLAGS.ACTIVE_DEVELOPER);
    return { has_badge: has };
  }

  async claimActiveDeveloper() {
    this._log('🔧 جاري تجهيز شارة Active Developer تلقائي...');

    // step 1: check existing apps
    let apps = await GET(this.token, '/applications');
    let app = null;

    if (Array.isArray(apps) && apps.length > 0) {
      app = apps[0];
      this._log(`📱 لقيت تطبيق موجود: ${app.name}`);
    } else {
      // step 2: create new application
      this._log('📱 إنشاء تطبيق جديد على Developer Portal...');
      const appName = 'AutoDev_' + Math.random().toString(36).slice(2, 8);
      app = await POST(this.token, '/applications', { name: appName });
      if (app.error || !app.id) {
        this._log(`❌ فشل إنشاء التطبيق: ${app.error || app.message || 'unknown'}`, 'error');
        return { success: false, error: 'فشل إنشاء التطبيق', detail: app };
      }
      this._log(`✅ تم إنشاء التطبيق: ${app.name} (${app.id})`);
    }

    // step 3: ensure bot exists on the app
    if (!app.bot) {
      this._log('🤖 إنشاء بوت للتطبيق...');
      const bot = await POST(this.token, `/applications/${app.id}/bot`, {});
      if (bot.error && !bot.token) {
        // bot might already exist — that's fine
        this._log('🤖 البوت موجود أو تم إنشاؤه');
      } else {
        this._log('✅ تم إنشاء البوت');
      }
    } else {
      this._log('🤖 البوت موجود بالفعل');
    }

    // step 4: register a global slash command so the app has "activity"
    this._log('⚡ تسجيل أمر slash command...');
    const cmd = await POST(this.token, `/applications/${app.id}/commands`, {
      name: 'ping', description: 'Test command for active developer badge', type: 1,
    });
    if (!cmd.error) {
      this._log('✅ تم تسجيل الأمر /ping');
    }

    // step 5: get user's guilds and try to add the bot to the first one
    this._log('🔗 ربط البوت بسيرفر...');
    const guilds = await GET(this.token, '/users/@me/guilds');
    let botAdded = false;
    if (Array.isArray(guilds) && guilds.length > 0) {
      // try to authorize bot to first guild where user has manage_guild
      for (const guild of guilds) {
        if (guild.owner || (Number(guild.permissions) & 0x20)) { // MANAGE_GUILD
          const authResult = await POST(this.token, '/oauth2/authorize', {
            authorize: true,
            guild_id: guild.id,
            permissions: '0',
            application_id: app.id,
            scope: 'bot applications.commands',
          });
          if (!authResult.error) {
            this._log(`✅ تم إضافة البوت لسيرفر: ${guild.name}`);
            botAdded = true;
            break;
          }
        }
      }
      if (!botAdded) {
        // try authorizing without manage_guild check
        const guild = guilds[0];
        const authResult = await POST(this.token, '/oauth2/authorize', {
          authorize: true, guild_id: guild.id, permissions: '0',
          application_id: app.id, scope: 'bot applications.commands',
        });
        if (!authResult.error) {
          this._log(`✅ تم إضافة البوت لسيرفر: ${guild.name}`);
          botAdded = true;
        }
      }
    }

    if (!botAdded) {
      this._log('⚠ ما قدرت أضيف البوت لسيرفر — أضفه يدوي من الرابط', 'warn');
    }

    // step 6: try to claim the badge
    this._log('🏆 محاولة الحصول على الشارة...');
    // wait a bit for Discord to register the activity
    await new Promise(r => setTimeout(r, 2000));
    const r = await POST(this.token, `/applications/${app.id}/active-developer`, {});
    if (!r.error) {
      this._log('✅ تم الحصول على شارة Active Developer!');
      return { success: true, app_id: app.id, bot_added: botAdded };
    }

    // try alternative endpoints
    const r2 = await POST(this.token, '/users/@me/harvest', {});
    if (!r2.error) {
      this._log('✅ تم التقديم على شارة Active Developer');
      return { success: true, app_id: app.id, bot_added: botAdded };
    }

    // even if claim fails now, the setup is done
    this._log('⚠ تم تجهيز كل شي — الشارة قد تحتاج وقت (استخدم /ping مرة واحدة في سيرفرك ثم ارجع حاول)', 'warn');
    return {
      success: true, partial: true, app_id: app.id, bot_added: botAdded,
      invite_url: `https://discord.com/oauth2/authorize?client_id=${app.id}&scope=bot+applications.commands&permissions=0`,
      message: 'تم إنشاء التطبيق والبوت — استخدم /ping مرة وحدة بعدين ارجع فعّل الشارة',
    };
  }

  // ══════════════════════════════════════════════════════════════
  // BADGES
  // ══════════════════════════════════════════════════════════════

  async getBadges() {
    const me = await GET(this.token, '/users/@me');
    if (me.error) return { error: me };
    const flags = me.public_flags || 0;
    const badges = [];
    for (const [key, bit] of Object.entries(BADGE_FLAGS)) {
      if (flags & bit) badges.push({ id: key, name: BADGE_NAMES[key] || key, active: true });
    }

    // also try profile endpoint for more badges
    const profile = await GET(this.token, `/users/${this.userInfo.id}/profile?with_mutual_guilds=false`);
    const profileBadges = profile?.badges || [];
    for (const b of profileBadges) {
      if (!badges.find(x => x.id === b.id)) {
        badges.push({ id: b.id, name: b.description || b.id, active: true });
      }
    }

    return { user_id: this.userInfo.id, badge_count: badges.length, badges, public_flags: flags };
  }

  // ══════════════════════════════════════════════════════════════
  // FAKE SESSIONS
  // ══════════════════════════════════════════════════════════════

  async startSession(gameName, durationMin = 30, streaming = false) {
    let game = GAME_LIBRARY.find(g => g.name.toLowerCase() === (gameName || '').toLowerCase());
    if (!game) game = { name: gameName || 'Custom Game', id: '' };
    this.gateway.setActivity(game, { streaming });
    this._log(`🎮 جلسة ${streaming ? 'بث' : 'لعب'}: ${game.name} (${durationMin}د)`);
    if (this._sessionTimer) clearTimeout(this._sessionTimer);
    this._sessionTimer = setTimeout(() => {
      this.gateway.clearActivity();
      this._log(`⏹ انتهت الجلسة: ${game.name}`);
    }, durationMin * 60 * 1000);
    return { success: true, game: game.name, streaming, duration_min: durationMin };
  }

  async startCustomSession(name, details, state, type = 0, durationMin = 60, status = null, imageUrl = null, elapsedMin = 0) {
    const now = Date.now();
    // elapsed_min: fake how long the activity has been running (e.g. 180 = shows "3 hours elapsed")
    const startTime = elapsedMin > 0 ? now - (elapsedMin * 60 * 1000) : now;
    const activity = {
      name,
      type: Number(type),
      timestamps: { start: startTime },
      created_at: now,
    };
    if (details) activity.details = details;
    if (state) activity.state = state;
    if (type === 1) { activity.url = 'https://www.twitch.tv/discord'; }
    // Discord Rich Presence images ONLY work with registered application assets.
    // Raw URLs (imgur etc) do NOT work — Discord ignores them.
    // Images show automatically when the activity name matches a known Discord game/app.

    // set user status if provided (online/idle/dnd/invisible)
    if (status) this.gateway._userStatus = status;
    this.gateway.setMultiActivity([activity], status);
    const statusNames = { online: 'متصل', idle: 'غائب', dnd: 'عدم الإزعاج', invisible: 'مخفي' };
    this._log(`🎮 جلسة مخصصة: ${name} (${durationMin}د)${elapsedMin ? ' — ⏱ ' + elapsedMin + 'د مضت' : ''}${status ? ' — حالة: ' + (statusNames[status] || status) : ''}`);

    if (this._sessionTimer) clearTimeout(this._sessionTimer);
    this._sessionTimer = setTimeout(() => {
      this.gateway.clearActivity();
      this._log(`⏹ انتهت الجلسة: ${name}`);
    }, durationMin * 60 * 1000);

    return { success: true, name, details, state, type, duration_min: durationMin, elapsed_min: elapsedMin };
  }

  clearActivity() {
    if (this._sessionTimer) clearTimeout(this._sessionTimer);
    this.gateway.clearActivity();
    this._log('⏹ تم إيقاف الجلسة');
  }

  // ══════════════════════════════════════════════════════════════
  // VIP VOICE PINNING
  // ══════════════════════════════════════════════════════════════

  async getGuilds() {
    const g = await GET(this.token, '/users/@me/guilds');
    if (Array.isArray(g)) return g.map(s => ({ id: s.id, name: s.name, icon: s.icon }));
    return [];
  }

  async getVoiceChannels(guildId) {
    const ch = await GET(this.token, `/guilds/${guildId}/channels`);
    if (!Array.isArray(ch)) return [];
    return ch.filter(c => c.type === 2).map(c => ({ id: c.id, name: c.name }));
  }

  async voiceJoin(guildId, channelId, selfMute = true, selfDeaf = true) {
    this.gateway.voiceConnect(guildId, channelId, selfMute, selfDeaf);
    this._voiceActive.set(guildId, { channelId, selfMute, selfDeaf });

    // auto-rejoin every 5s in case of kick — fast reconnect
    if (this._voiceTimers.has(guildId)) clearInterval(this._voiceTimers.get(guildId));
    this._voiceTimers.set(guildId, setInterval(() => {
      if (this._voiceActive.has(guildId)) {
        this.gateway.voiceConnect(guildId, channelId, selfMute, selfDeaf);
      }
    }, 5_000));

    this._log(`🔊 دخول فويس: ${channelId} (${selfMute ? 'صامت' : 'مفتوح'})`);
    return { success: true, guild_id: guildId, channel_id: channelId };
  }

  async voiceLeave(guildId) {
    this.gateway.voiceDisconnect(guildId);
    this._voiceActive.delete(guildId);
    if (this._voiceTimers.has(guildId)) {
      clearInterval(this._voiceTimers.get(guildId));
      this._voiceTimers.delete(guildId);
    }
    this._log(`🔇 خروج فويس: ${guildId}`);
    return { success: true };
  }

  async voiceLeaveAll() {
    for (const gid of this._voiceActive.keys()) {
      this.gateway.voiceDisconnect(gid);
    }
    this._voiceActive.clear();
    for (const t of this._voiceTimers.values()) clearInterval(t);
    this._voiceTimers.clear();
    this._log('🔇 خروج من كل الفويسات');
    return { success: true };
  }

  getVoiceStatus() {
    const active = [];
    for (const [gid, info] of this._voiceActive) {
      active.push({ guild_id: gid, channel_id: info.channelId, self_mute: info.selfMute, self_deaf: info.selfDeaf });
    }
    return active;
  }

  // ══════════════════════════════════════════════════════════════
  // STREAMING BADGE (Nitro subscriber streamer badge)
  // ══════════════════════════════════════════════════════════════

  async startStreamSession(gameName, durationMin = 60) {
    let game = GAME_LIBRARY.find(g => g.name.toLowerCase() === (gameName || '').toLowerCase());
    if (!game) game = { name: gameName || 'Streaming', id: '' };

    // set streaming activity — full client format for detection
    const now = Date.now();
    const activity = {
      name: game.name, type: 1, // streaming
      url: 'https://www.twitch.tv/discord',
      timestamps: { start: now },
      created_at: now,
      state: 'Live on Twitch', details: `Streaming ${game.name}`,
    };
    if (game.id) activity.application_id = game.id;
    this.gateway.setMultiActivity([activity]);

    this._log(`📡 بث مباشر: ${game.name} (${durationMin}د)`);

    if (this._sessionTimer) clearTimeout(this._sessionTimer);
    this._sessionTimer = setTimeout(() => {
      this.gateway.clearActivity();
      this._log(`⏹ انتهى البث: ${game.name}`);
    }, durationMin * 60 * 1000);

    return { success: true, game: game.name, duration_min: durationMin };
  }

  // Go Live — join voice channel + start stream for streaming badge
  async startGoLive(guildId, channelId, durationMin = 60) {
    // 1. join voice channel
    this.gateway.voiceConnect(guildId, channelId, true, true);
    this._voiceActive.set(guildId, { channelId, selfMute: true, selfDeaf: true });
    this._log(`📡 Go Live: joining voice ${channelId}`);

    // small delay then start stream
    await sleep(2000);

    // 2. start Go Live stream via gateway op 18
    this.gateway.startStream(guildId, channelId);
    this._log(`📡 Go Live: stream started in ${channelId}`);

    // 3. also set streaming presence
    const now = Date.now();
    const activity = {
      name: 'Screen Share', type: 1,
      url: 'https://www.twitch.tv/discord',
      timestamps: { start: now },
      created_at: now,
      state: 'Streaming', details: 'Go Live',
    };
    this.gateway.setMultiActivity([activity]);

    // 4. auto-stop timer
    this._streamGoLiveTimer = setTimeout(async () => {
      await this.stopGoLive(guildId, channelId);
    }, durationMin * 60 * 1000);

    return { success: true, guild_id: guildId, channel_id: channelId, duration_min: durationMin };
  }

  async stopGoLive(guildId, channelId) {
    if (this._streamGoLiveTimer) { clearTimeout(this._streamGoLiveTimer); this._streamGoLiveTimer = null; }
    this.gateway.stopStream(guildId, channelId);
    await sleep(500);
    this.gateway.voiceDisconnect(guildId);
    this._voiceActive.delete(guildId);
    this.gateway.clearActivity();
    this._log('⏹ Go Live stopped');
    return { success: true };
  }

  // ══════════════════════════════════════════════════════════════
  // GAME ROTATION — BADGE FARMING
  // ══════════════════════════════════════════════════════════════

  _gameRotationCtrl = null;
  _gameRotationRunning = false;

  // Report a completed game session to Discord's activity tracking system
  // This is what the Desktop client does — feeds into badge progression
  async _reportActivitySession(game, startMs, endMs) {
    if (!game.id) return; // need a real application_id
    try {
      const r = await fetch(`${API}/activities`, {
        method: 'POST',
        headers: {
          Authorization: this.token, 'Content-Type': 'application/json',
          'User-Agent': UA, 'X-Super-Properties': SUPER_PROPS,
        },
        body: JSON.stringify({
          application_id: game.id,
          type: 0,
          timestamp_start: startMs,
          timestamp_end: endMs,
        }),
      });
      if (r.ok) {
        this._log(`📊 تم تسجيل جلسة ${game.name} (${Math.round((endMs - startMs) / 60000)}د) لنظام الشارات`);
      }
    } catch {}
  }

  // Report multiple past game sessions at once to build badge history
  async reportBulkActivitySessions(games, sessionsPerGame = 3, sessionMinutes = 30) {
    let reported = 0;
    const now = Date.now();
    for (let g = 0; g < games.length; g++) {
      const game = GAME_LIBRARY.find(x => x.name.toLowerCase() === games[g].toLowerCase()) || { name: games[g], id: '' };
      if (!game.id) continue;
      for (let s = 0; s < sessionsPerGame; s++) {
        const hoursAgo = (g * sessionsPerGame + s + 1);
        const start = now - (hoursAgo * 3600000);
        const end = start + (sessionMinutes * 60000);
        try {
          const r = await fetch(`${API}/activities`, {
            method: 'POST',
            headers: {
              Authorization: this.token, 'Content-Type': 'application/json',
              'User-Agent': UA, 'X-Super-Properties': SUPER_PROPS,
            },
            body: JSON.stringify({ application_id: game.id, type: 0, timestamp_start: start, timestamp_end: end }),
          });
          if (r.ok) reported++;
          if (r.status === 429) {
            const d = await r.json().catch(() => ({}));
            await sleep((d.retry_after || 3) * 1000 + 500);
            s--; continue; // retry
          }
        } catch {}
        await sleep(600); // small delay between reports
      }
    }
    this._log(`📊 تم تسجيل ${reported} جلسة لعب لنظام الشارات`);
    return { success: true, reported };
  }

  async startGameRotation(gameNames, minutesPerGame = 30) {
    if (this._gameRotationRunning) await this.stopGameRotation();
    this._gameRotationRunning = true;
    this._gameRotationCtrl = { aborted: false };

    const games = gameNames.map(name => {
      const found = GAME_LIBRARY.find(g => g.name.toLowerCase() === name.toLowerCase());
      return found || { name, id: '' };
    });

    if (!games.length) { this._log('⚠ لا توجد ألعاب محددة', 'warn'); return { success: false }; }

    this._log(`🎮 بدء تدوير الألعاب: ${games.length} لعبة × ${minutesPerGame}د لكل لعبة`);

    // Report bulk past sessions on first start to seed badge data
    this.reportBulkActivitySessions(gameNames, 2, 30).catch(() => {});

    const ctrl = this._gameRotationCtrl;
    (async () => {
      let round = 1;
      while (!ctrl.aborted) {
        for (let i = 0; i < games.length && !ctrl.aborted; i++) {
          const game = games[i];
          const sessionStart = Date.now();
          this.gateway.setActivity(game, { streaming: false });
          this._log(`🎮 [جولة ${round}] يلعب: ${game.name} (${minutesPerGame}د)`);

          let elapsed = 0;
          const dur = minutesPerGame * 60 * 1000;
          while (elapsed < dur && !ctrl.aborted) {
            await sleep(20_000);
            elapsed += 20_000;
          }

          // Report the completed session to Discord's activity tracking
          if (!ctrl.aborted || elapsed > 60000) {
            this._reportActivitySession(game, sessionStart, Date.now());
          }
        }
        round++;
        if (!ctrl.aborted) this._log(`🔄 جولة ${round} — إعادة تدوير الألعاب`);
      }
      this.gateway.clearActivity();
      this._gameRotationRunning = false;
      this._log('⏹ تم إيقاف تدوير الألعاب');
    })();

    return { success: true, games: games.map(g => g.name), minutes_per_game: minutesPerGame };
  }

  async stopGameRotation() {
    if (this._gameRotationCtrl) this._gameRotationCtrl.aborted = true;
    this._gameRotationRunning = false;
    this.gateway.clearActivity();
    return { success: true };
  }

  getRotationStatus() {
    return { running: this._gameRotationRunning, game: this.gateway.currentGame?.name || null };
  }

  // ══════════════════════════════════════════════════════════════
  // EARN BADGES — one-click badge activation
  // ══════════════════════════════════════════════════════════════

  async earnBadge(badgeId) {
    const action = BADGE_ACTIONS[badgeId];
    if (!action) return { success: false, error: 'هذي الشارة ما تقدر تجيبها من هنا' };

    switch (action.type) {
      case 'hypesquad': {
        const r = await this.setHypeSquad(action.house_id);
        if (r.success) this._log('✅ شارة HypeSquad شارة بروفايل حقيقية — شيك بروفايلك الحين!');
        return r;
      }
      case 'active_developer': {
        const r = await this.claimActiveDeveloper();
        if (r.success && !r.partial) this._log('✅ شارة Active Developer شارة بروفايل حقيقية!');
        return r;
      }
      case 'game_rotation': {
        this._log('🎮 تشغيل تدوير الألعاب — شارة Game Variety + Game Time');
        const allNames = GAME_LIBRARY.map(g => g.name);
        return await this.startGameRotation(allNames, 30);
      }
      case 'streaming': {
        this._log('📡 تشغيل حالة البث — لشارة Streaming روح صفحة البث > Go Live');
        return await this.startStreamSession('VALORANT', 1440);
      }
      case 'quests':
        return await this.autoCompleteAll(false);
      default:
        return { success: false, error: 'نوع غير معروف' };
    }
  }

  async earnMultipleBadges(badgeIds) {
    const results = [];
    for (const id of badgeIds) {
      const badge = BADGE_CATALOG.find(b => b.id === id);
      if (!badge || !badge.earnable) {
        results.push({ id, success: false, error: 'غير قابلة للتحصيل' });
        continue;
      }
      this._log(`🏅 تفعيل شارة: ${badge.nameAr}`);
      const r = await this.earnBadge(id);
      results.push({ id, ...r });
      await sleep(1500); // rate limit
    }
    return { results };
  }

  async getBadgeCatalog() {
    // refresh user flags to get latest badge state
    try {
      const me = await GET(this.token, '/users/@me');
      if (!me.error && me.public_flags !== undefined) {
        this.userInfo.public_flags = me.public_flags;
      }
    } catch {}
    const flags = this.userInfo?.public_flags || 0;
    return BADGE_CATALOG.map(b => {
      let owned = false;
      if (b.id === 'hypesquad_bravery') owned = !!(flags & BADGE_FLAGS.HOUSE_BRAVERY);
      else if (b.id === 'hypesquad_brilliance') owned = !!(flags & BADGE_FLAGS.HOUSE_BRILLIANCE);
      else if (b.id === 'hypesquad_balance') owned = !!(flags & BADGE_FLAGS.HOUSE_BALANCE);
      else if (b.id === 'active_developer') owned = !!(flags & BADGE_FLAGS.ACTIVE_DEVELOPER);
      else if (b.id === 'bug_hunter_1') owned = !!(flags & BADGE_FLAGS.BUG_HUNTER_1);
      else if (b.id === 'bug_hunter_2') owned = !!(flags & BADGE_FLAGS.BUG_HUNTER_2);
      else if (b.id === 'discord_partner') owned = !!(flags & BADGE_FLAGS.PARTNER);
      else if (b.id === 'verified_bot_dev') owned = !!(flags & BADGE_FLAGS.VERIFIED_BOT_DEV);
      else if (b.id === 'early_supporter') owned = !!(flags & BADGE_FLAGS.EARLY_SUPPORTER);
      // activity badges — check if rotation is running
      else if (b.id === 'game_activity' || b.id === 'playtime') owned = this._gameRotationRunning;
      else if (b.id === 'streaming') owned = this.gateway.currentGame && false; // can check
      return { ...b, owned, running: b.id === 'game_activity' && this._gameRotationRunning || b.id === 'streaming' && !!this._sessionTimer };
    });
  }

  // ══════════════════════════════════════════════════════════════
  // MULTI-SESSION — run multiple things at once
  // ══════════════════════════════════════════════════════════════

  _multiSessions = new Map(); // name -> { timer, type }

  async startMultiSession(sessions) {
    // sessions = [{ type: 'game'|'stream'|'voice', game?, guild_id?, channel_id?, duration? }]
    const results = [];
    for (const s of sessions) {
      if (s.type === 'game') {
        const game = GAME_LIBRARY.find(g => g.name.toLowerCase() === (s.game || '').toLowerCase()) || { name: s.game || 'Game', id: '' };
        this.gateway.setActivity(game, { streaming: false });
        const dur = (s.duration || 30) * 60 * 1000;
        const timer = setTimeout(() => { this._multiSessions.delete(s.game); }, dur);
        this._multiSessions.set(s.game, { timer, type: 'game' });
        this._log(`🎮 جلسة: ${game.name} (${s.duration || 30}د)`);
        results.push({ type: 'game', game: game.name, success: true });
      }
      else if (s.type === 'stream') {
        await this.startStreamSession(s.game || 'VALORANT', s.duration || 60);
        results.push({ type: 'stream', game: s.game, success: true });
      }
      else if (s.type === 'voice' && s.guild_id && s.channel_id) {
        await this.voiceJoin(s.guild_id, s.channel_id, true, true);
        results.push({ type: 'voice', guild_id: s.guild_id, success: true });
      }
    }
    return { success: true, sessions: results };
  }

  getActiveSessions() {
    const list = [];
    // game rotation
    if (this._gameRotationRunning) {
      list.push({ type: 'rotation', game: this.gateway.currentGame?.name || '...', status: 'running' });
    }
    // current activity
    if (this.gateway.currentGame && !this._gameRotationRunning) {
      list.push({ type: 'game', game: this.gateway.currentGame.name, status: 'running' });
    }
    // voice channels
    for (const [gid, info] of this._voiceActive) {
      list.push({ type: 'voice', guild_id: gid, channel_id: info.channelId, status: 'running' });
    }
    // quests
    for (const [qid] of this._questRunners) {
      list.push({ type: 'quest', quest_id: qid, status: 'running' });
    }
    return list;
  }

  // ══════════════════════════════════════════════════════════════
  // ACCOUNT INFO
  // ══════════════════════════════════════════════════════════════

  async getFullProfile() {
    const me = await GET(this.token, '/users/@me');
    if (me.error) return me;
    const settings = await GET(this.token, '/users/@me/settings');
    return {
      ...me,
      locale: settings?.locale,
      theme: settings?.theme,
      status: settings?.status,
    };
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
