import express from 'express';
import { createServer } from 'node:http';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Server } from 'socket.io';
import { Telegraf, Markup } from 'telegraf';
import { items,palettes,plans,rewards,successReward } from './public/catalog.js';
import { createMembership,paidPrices } from './membership.js';
import { roomInviteUrl } from './public/invite.js';

const { BOT_TOKEN, BOT_USERNAME, APP_SHORT_NAME, PUBLIC_URL } = process.env;
const bot = BOT_TOKEN ? new Telegraf(BOT_TOKEN) : null;
const dev = process.env.NODE_ENV !== 'production' &&
  (process.env.DEV_GUESTS === '1' || (!BOT_TOKEN && process.env.DEV_GUESTS === undefined));
const dbPath = process.env.DATABASE_PATH || 'data/methaq.sqlite';
if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
const db = new DatabaseSync(dbPath);
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS players(id TEXT PRIMARY KEY, points INTEGER DEFAULT 0, streak INTEGER DEFAULT 0,
    last_day TEXT, inventory TEXT DEFAULT '{}', equipped TEXT DEFAULT '{}');
  CREATE TABLE IF NOT EXISTS results(room TEXT, player TEXT, status TEXT, reward INTEGER, minutes INTEGER,
    date TEXT DEFAULT CURRENT_TIMESTAMP, goal_done INTEGER, forgiven INTEGER DEFAULT 0, old_streak INTEGER DEFAULT 0,
    PRIMARY KEY(room,player));
`);
const app = express();
export const http = createServer(app);
const io = new Server(http, { pingInterval:4000, pingTimeout:4000 });
const rooms = new Map();
const memberships = new Map();
const minute = 60000;
export const clock = { now: Date.now };
const membership = createMembership(db,() => clock.now());
const billingEnabled = Boolean(bot && Object.values(paidPrices).some(Boolean));
const fail = (message) => { throw new Error(message); };
const query = (sql, ...args) => db.prepare(sql).get(...args);
const run = (sql, ...args) => db.prepare(sql).run(...args);
const transaction = (fn) => {
  db.exec('BEGIN');
  try { const result = fn(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; }
};

function profile(id) {
  const player = query('SELECT * FROM players WHERE id=?', id);
  const stats = query(`SELECT count(*) FILTER (WHERE status='success') AS completed,
    coalesce(sum(minutes) FILTER (WHERE status='success'),0) AS minutes,
    count(*) FILTER (WHERE status='left' AND forgiven=0) AS left
    FROM results WHERE player=?`, id);
  const history = db.prepare('SELECT * FROM results WHERE player=? ORDER BY date DESC,rowid DESC LIMIT 20').all(id);
  const today = new Date(clock.now()).toISOString().slice(0,10);
  const yesterday = new Date(clock.now()-86400000).toISOString().slice(0,10);
  const streak = [today,yesterday].includes(player.last_day) ? player.streak : 0;
  const plan = membership.planStatus(id);
  const cosmetics = membership.cosmetics(id);
  const appearance = membership.appearance(id);
  const inventory = JSON.parse(player.inventory);
  const equipped = JSON.parse(player.equipped);
  if (plan.tier === 'free') {
    for (const slot of ['title','frame']) if (!cosmetics[equipped[slot]]) delete equipped[slot];
    if (!inventory[equipped.theme]) delete equipped.theme;
    if (palettes[appearance.palette]?.premium) appearance.palette = 'emerald';
  }
  return { ...player, streak, inventory, equipped, plan, cosmetics, appearance, now:clock.now(),
    prices:billingEnabled && !id.startsWith('guest:') ? paidPrices : {},
    ...stats, reliability: stats.completed + stats.left ? Math.round(100*stats.completed/(stats.completed+stats.left)) : 100, history };
}

function use(id, item) {
  const { inventory } = profile(id);
  if (!inventory[item]) fail('هذا العنصر غير متوفر في مخزونك.');
  inventory[item]--;
  run('UPDATE players SET inventory=? WHERE id=?', JSON.stringify(inventory), id);
}

function authenticate(auth = {}) {
  if (BOT_TOKEN && typeof auth.initData === 'string' && auth.initData) {
    const params = new URLSearchParams(auth.initData);
    const hash = Buffer.from(params.get('hash') || '', 'hex');
    params.delete('hash');
    params.sort();
    const key = createHmac('sha256','WebAppData').update(BOT_TOKEN).digest();
    const expected = createHmac('sha256',key).update([...params].map(([k,v]) => k+'='+v).join('\n')).digest();
    const age = clock.now()/1000 - Number(params.get('auth_date'));
    if (hash.length !== expected.length || !timingSafeEqual(hash, expected) || !Number.isFinite(age) || age > 86400 || age < -60) fail('تعذّر التحقق من حساب تليجرام.');
    const user = JSON.parse(params.get('user'));
    return { id: String(user.id), name: [user.first_name,user.last_name].filter(Boolean).join(' '), photo: user.photo_url };
  }
  if (dev && typeof auth.guest === 'string' && /^[a-f0-9-]{36}$/.test(auth.guest)) {
    return { id: 'guest:'+auth.guest, name: String(auth.name || 'ضيف ميثاق').trim().slice(0,32) || 'ضيف ميثاق' };
  }
  fail('افتح ميثاق التركيز من تطبيق تليجرام.');
}

function send(room) {
  io.to(room.id).emit('room', { ...room, now: clock.now(), members: room.members.map(member => {
    const { equipped } = profile(member.id);
    return { ...member, equipped };
  }) });
}

function finish(room, leaving) {
  if (room.phase !== 'active') return;
  const now = clock.now();
  transaction(() => {
    for (const p of room.members) {
      const current = profile(p.id);
      const status = !leaving ? 'success' : leaving === p.id ? 'left' : 'steadfast';
      const reward = status === 'success' ? successReward : status === 'left' ? -Math.min(rewards.withdrawal,current.points) : rewards.steadfast;
      const today = new Date(now).toISOString().slice(0,10);
      const streak = status === 'success' ? current.streak + Number(current.last_day !== today) : status === 'left' ? 0 : current.streak;
      run('UPDATE players SET points=points+?, streak=?, last_day=? WHERE id=?', reward, streak, status === 'success' ? today : current.last_day, p.id);
      run('INSERT INTO results(room,player,status,reward,minutes,old_streak) VALUES(?,?,?,?,?,?)',room.id,p.id,status,reward,room.minutes,current.streak);
    }
  });
  room.phase = 'outcome';
  room.finished = now;
  for (const p of room.members) io.to('player:'+p.id).emit('profile',profile(p.id));
  send(room);
}

function tick(room, now) {
  if (room.phase !== 'active') return;
  const failed = room.members.map(p => [p, Math.min(p.exitAt || Infinity,p.checkUntil || Infinity)])
    .filter(([,deadline]) => deadline <= now && deadline < room.endAt).sort((a,b) => a[1]-b[1])[0];
  if (failed) return finish(room, failed[0].id);
  if (now >= room.endAt) return finish(room);
  if (now < room.startsAt || now < room.pauseUntil) return;
  for (const p of room.members) {
    if (p.nextCheck && now >= p.nextCheck && room.endAt-now > 35000) {
      p.nextCheck = null;
      p.checkUntil = now+30000;
      io.to('player:'+p.id).emit('signal','check');
    }
    p.idle = now-p.activity > minute;
  }
  send(room);
}

setInterval(() => {
  const now = clock.now();
  for (const [id,room] of rooms) {
    if ((room.finished && now-room.finished > 86400000) || (room.phase === 'lobby' && now-room.created > 86400000)) {
      rooms.delete(id);
      for (const p of room.members) if (memberships.get(p.id) === id) memberships.delete(p.id);
    } else tick(room, now);
  }
}, 1000).unref();

io.use((socket,next) => { try { socket.data.user = authenticate(socket.handshake.auth); next(); } catch (error) { next(error); } });
io.on('connection', (socket) => {
  const user = socket.data.user;
  const { id } = user;
  run('INSERT OR IGNORE INTO players(id) VALUES(?)', id);
  const playerRoom = 'player:'+id;
  socket.join(playerRoom);
  const current = () => rooms.get(memberships.get(id));
  const previous = current();
  if (previous) {
    socket.join(previous.id);
    tick(previous,clock.now());
    send(previous);
  }
  const syncProfile = () => io.to(playerRoom).emit('profile',profile(id));
  const isPaid = (player) => membership.planStatus(player).tier !== 'free';
  socket.emit('hello', { user, profile: profile(id), bot: BOT_USERNAME, shortName: APP_SHORT_NAME });

  function action(event, fn) {
    socket.on(event, (payload, ack) => {
      if (typeof ack !== 'function') return;
      try { fn(payload ?? {}); ack({ ok:true }); } catch (error) { ack({ error:error.message }); }
    });
  }
  let nextInviteAt = 0;
  socket.on('prepareInvite', async (_payload, ack) => {
    if (typeof ack !== 'function') return;
    const telegramId = Number(id);
    if (!bot || !Number.isSafeInteger(telegramId) || telegramId <= 0) {
      return ack({ error:'أرسل الدعوة من داخل تطبيق تليجرام.' });
    }
    const room = current();
    if (room?.phase !== 'lobby' || room.members.length !== 1) {
      return ack({ error:'الدعوة متاحة عندما تكون الغرفة بانتظار شريك.' });
    }
    const url = roomInviteUrl({ bot:BOT_USERNAME, shortName:APP_SHORT_NAME, code:room.id });
    if (!url) return ack({ error:'تعذّر تجهيز الدعوة. تحقّق من اسم البوت في الاستضافة.' });
    if (clock.now() < nextInviteAt) return ack({ error:'انتظر قليلًا قبل إعادة المحاولة.' });
    nextInviteAt = clock.now()+10000;
    try {
      const prepared = await bot.telegram.callApi('savePreparedInlineMessage', {
        user_id:telegramId,
        allow_user_chats:true,
        result:{
          type:'article',
          id:room.id,
          title:'دعوة إلى ميثاق التركيز',
          input_message_content:{ message_text:'انضم إليّ في جلسة تركيز ثنائية لمدة '+room.minutes+' دقيقة.' },
          reply_markup:{ inline_keyboard:[[{ text:'انضمام', url }]] }
        }
      }, { signal:AbortSignal.timeout(8000) });
      if (current() !== room || room.phase !== 'lobby' || room.members.length !== 1) {
        return ack({ error:'تغيّرت حالة الغرفة. افتح غرفة جديدة لإرسال دعوة.' });
      }
      nextInviteAt = 0;
      ack({ messageId:prepared.id });
    } catch {
      ack({ error:'تعذّر تجهيز رسالة الدعوة من تليجرام. جرّب بعد قليل.' });
    }
  });
  action('refreshProfile', () => {
    syncProfile();
    if (current()) send(current());
  });
  action('appearance', ({mode,palette}) => {
    if (!['dark','light'].includes(mode) || !Object.hasOwn(palettes,palette)) fail('المظهر غير متاح.');
    if (palettes[palette].premium && !isPaid(id)) fail('هذا اللون متاح مع برو وسبيشل.');
    membership.setAppearance(id,mode,palette);
    syncProfile();
  });

  let nextInvoiceAt = 0;
  socket.on('membershipInvoice', async (payload, ack) => {
    if (typeof ack !== 'function') return;
    const plan = payload?.plan;
    if (!billingEnabled || !Object.hasOwn(plans,plan) || !paidPrices[plan] || id.startsWith('guest:')) {
      return ack({error:'شراء هذه العضوية غير متاح الآن.'});
    }
    if (membership.planStatus(id).tier === 'special') return ack({error:'عضوية سبيشل مفعّلة مدى الحياة.'});
    if (clock.now() < nextInvoiceAt) return ack({error:'انتظر قليلًا ثم حاول مجددًا.'});
    nextInvoiceAt = clock.now()+10000;
    const title = 'ميثاق التركيز · '+plans[plan].title;
    try {
      const url = await bot.telegram.callApi('createInvoiceLink',{
        title, description:'تفعيل مزايا العضوية لمدة '+plans[plan].duration+'.',
        payload:membership.newInvoice(id,plan), currency:'XTR', provider_token:'',
        prices:[{label:title,amount:paidPrices[plan]}]
      },{signal:AbortSignal.timeout(8000)});
      nextInvoiceAt = 0;
      ack({url});
    } catch {
      ack({error:'تعذّر فتح فاتورة نجوم تليجرام.'});
    }
  });
  function enter(room, goal) {
    const old = current();
    if (old && old.phase !== 'outcome') fail('أكمل غرفتك الحالية أولًا.');
    if (old) io.in(playerRoom).socketsLeave(old.id);
    room.members.push({ ...user, goal, ready:false, activity:clock.now() });
    memberships.set(id,room.id);
    io.in(playerRoom).socketsJoin(room.id);
    send(room);
  }
  const goalText = (value) => {
    const goal = String(value || '').trim().slice(0,160);
    if (!goal) fail('اكتب هدفك أولًا.');
    return goal;
  };
  action('create', ({ minutes, goal, pact }) => {
    if (![25,50,90,120].includes(minutes)) fail('اختر مدة صالحة.');
    if (minutes === 120 && !isPaid(id) && !profile(id).inventory.marathon) fail('تحتاج إلى تذكرة الماراثون.');
    const room = { id:randomUUID().replaceAll('-',''), phase:'lobby', created:clock.now(),
      minutes, pact:String(pact || '').trim().slice(0,160), members:[] };
    enter(room,goalText(goal));
    rooms.set(room.id,room);
  });
  action('join', ({ code, goal }) => {
    const room = rooms.get(code);
    if (!room || room.phase !== 'lobby' || room.members.length >= 2) fail('الغرفة ممتلئة أو انتهت صلاحية الدعوة.');
    enter(room,goalText(goal));
  });
  action('leaveLobby', () => {
    const room = current();
    if (room?.phase !== 'lobby') return;
    if (room.members[0].id === id) {
      for (const member of room.members) {
        memberships.delete(member.id);
        io.to('player:'+member.id).emit('room',null);
      }
      io.in(room.id).socketsLeave(room.id);
      rooms.delete(room.id);
      return;
    }
    room.members = room.members.filter(p => p.id !== id);
    for (const p of room.members) p.ready = false;
    memberships.delete(id);
    io.in(playerRoom).socketsLeave(room.id);
    io.to(playerRoom).emit('room',null);
    if (!room.members.length) rooms.delete(room.id); else send(room);
  });
  action('ready', () => {
    const room = current();
    if (room?.phase !== 'lobby') return;
    const p = room.members.find(p => p.id === id);
    const starting = room.members.length === 2 && room.members.every(m => m.id === id || m.ready);
    if (starting && room.members.some(member => !io.sockets.adapter.rooms.get('player:'+member.id)?.size)) {
      fail('بانتظار عودة شريكك للاتصال.');
    }
    if (starting && room.minutes === 120) {
      const host = room.members[0].id;
      if (!isPaid(host)) use(host,'marathon');
      io.to('player:'+host).emit('profile',profile(host));
    }
    p.ready = true;
    if (starting) {
      room.phase = 'active';
      room.startsAt = clock.now()+3000;
      room.endAt = room.startsAt+room.minutes*minute;
      for (const m of room.members) m.nextCheck = room.startsAt + (2+Math.random()*(room.minutes-4))*minute;
    }
    send(room);
  });
  function active() {
    const room = current();
    if (room) tick(room,clock.now());
    if (room?.phase !== 'active') fail('الجلسة غير نشطة.');
    return [room,room.members.find(p => p.id === id),room.members.find(p => p.id !== id)];
  }
  function presence(hidden) {
    const room = current();
    if (room?.phase !== 'active') return;
    tick(room,clock.now());
    if (room.phase !== 'active') return;
    const p = room.members.find(p => p.id === id);
    if (hidden) p.exitAt ||= clock.now()+10000;
    else { p.exitAt = null; p.activity = clock.now(); }
    send(room);
  }
  action('presence', ({hidden}) => presence(hidden === true));
  socket.on('disconnect', () => { if (!io.sockets.adapter.rooms.get(playerRoom)?.size) presence(true); });
  action('activity', () => { const room = current(); if (room?.phase === 'active') room.members.find(p=>p.id===id).activity=clock.now(); });
  action('check', () => { const [room,p] = active(); p.checkUntil = null; p.activity = clock.now(); send(room); });
  action('withdraw', () => { const [room] = active(); finish(room,id); });
  action('signal', ({item}) => {
    const room = current();
    if (item === 'horn' && (room?.phase !== 'outcome' || !profile(id).history.some(r=>r.room===room.id && r.status==='success'))) fail('بوق الفوز متاح بعد إتمام الجلسة.');
    const [,p,partner] = item === 'horn' ? [room, room.members.find(m=>m.id===id),room.members.find(m=>m.id!==id)] : active();
    if (clock.now()-(p.lastSignal || 0)<10000) fail('انتظر قليلًا قبل إرسال تنبيه آخر.');
    if (item === 'nudge' && !partner.idle) fail('شريكك يركز الآن.');
    if (['zap','coffee','horn'].includes(item)) use(id,item);
    else if (item !== 'nudge') fail('تفاعل غير صالح.');
    p.lastSignal=clock.now();
    io.to('player:'+partner.id).emit('signal',item);
    syncProfile();
  });
  action('requestPause', () => {
    const [room] = active();
    if (clock.now() < room.startsAt || ((!isPaid(id) || room.premiumPauseUsed) && !profile(id).inventory.pause) || room.pauseUntil > clock.now() || room.pauseRequest?.until > clock.now()) fail('الاستراحة غير متاحة الآن.');
    room.pauseRequest = { id, until:clock.now()+30000 };
    send(room);
  });
  action('answerPause', ({accept}) => {
    const [room] = active();
    const request = room.pauseRequest;
    if (!request || request.id === id || request.until < clock.now()) fail('انتهت صلاحية طلب الاستراحة.');
    if (accept === true) {
      if (isPaid(request.id) && !room.premiumPauseUsed) room.premiumPauseUsed = true;
      else use(request.id,'pause');
      room.pauseUntil = clock.now()+3*minute;
      room.endAt += 3*minute;
      for (const p of room.members) {
        if (p.nextCheck) p.nextCheck += 3*minute;
        if (p.checkUntil) p.checkUntil += 3*minute;
      }
      io.to('player:'+request.id).emit('profile',profile(request.id));
    }
    room.pauseRequest = null;
    send(room);
  });
  action('buy', ({item}) => {
    if (!Object.hasOwn(items,item)) fail('العنصر غير موجود.');
    const [category,,cost] = items[item];
    const { points,inventory,cosmetics } = profile(id);
    if ([1,2].includes(category) && isPaid(id)) fail('العنصر متاح لك ضمن العضوية.');
    if (points < cost) fail('رصيدك لا يكفي لهذا العنصر.');
    if ((category === 1 && inventory[item]) || (category === 2 && cosmetics[item])) fail('هذا العنصر موجود في مخزونك.');
    inventory[item] = category === 2 ? 1 : (inventory[item] || 0)+1;
    transaction(() => {
      if (category === 2) membership.grantCosmetic(id,item);
      run('UPDATE players SET points=points-?,inventory=? WHERE id=?',cost,JSON.stringify(inventory),id);
    });
    syncProfile();
  });
  action('equip', ({item}) => {
    if (!Object.hasOwn(items,item) || ![1,2].includes(items[item][0])) fail('العنصر غير متاح.');
    const { inventory,cosmetics } = profile(id);
    const category = items[item][0];
    if (!isPaid(id) && !(category === 1 ? inventory[item] : cosmetics[item])) fail('العنصر غير متاح.');
    const equipped = JSON.parse(query('SELECT equipped FROM players WHERE id=?',id).equipped);
    const slot = category === 1 ? 'theme' : item === 'frame' ? 'frame' : 'title';
    equipped[slot]=equipped[slot]===item ? null : item;
    run('UPDATE players SET equipped=? WHERE id=?',JSON.stringify(equipped),id);
    syncProfile();
    if (current()) send(current());
  });
  action('result', ({done}) => {
    const room = current();
    if (room?.phase !== 'outcome' || typeof done !== 'boolean') return;
    run("UPDATE results SET goal_done=? WHERE room=? AND player=? AND status='success'",Number(done),room.id,id);
    syncProfile();
  });
  action('protect', ({item}) => {
    if (!['shield','eraser'].includes(item)) fail('عنصر غير صالح.');
    const last = profile(id).history[0];
    if (last?.status !== 'left' || (item === 'eraser' && last.forgiven)) fail('لا يوجد انسحاب حديث لمعالجته.');
    transaction(() => {
      if (item === 'shield' && (!last.old_streak || profile(id).streak)) fail('لا توجد سلسلة لاستعادتها.');
      use(id,item);
      if (item === 'shield') run('UPDATE players SET streak=? WHERE id=?',last.old_streak,id);
      else run('UPDATE results SET forgiven=1 WHERE room=? AND player=?',last.room,id);
    });
    syncProfile();
  });
});

app.get('/health', (_req,res) => res.json({ ok:true, guests:dev }));
app.use('/icons',express.static('node_modules/lucide-static/icons'));
app.use('/fonts',express.static('node_modules/@fontsource/ibm-plex-sans-arabic/files'));
app.use(express.static('public'));
http.listen(Number(process.env.PORT || 3000),'0.0.0.0',() => console.log('Methaq listening'));
if (bot && (billingEnabled || (PUBLIC_URL && process.env.RUN_BOT === '1'))) {
  if (PUBLIC_URL && process.env.RUN_BOT === '1') {
    bot.start(ctx => ctx.reply('ابدأ جلسة تركيز ثنائية مع ميثاق التركيز.', Markup.inlineKeyboard([Markup.button.webApp('افتح ميثاق التركيز',PUBLIC_URL)])));
    bot.help(ctx => ctx.reply('افتح التطبيق عبر /start وأنشئ غرفة وشارك الدعوة مع شريكك.'));
  }
  if (billingEnabled) {
    bot.command('paysupport', ctx => ctx.reply(process.env.PAYMENT_SUPPORT || 'للمساعدة بخصوص عضويتك، تواصل مع مشرف ميثاق التركيز وأرسل معرّف عملية الشراء الظاهر في تليجرام.'));
    bot.on('pre_checkout_query', async ctx => {
      const checkout = ctx.update.pre_checkout_query;
      const valid = membership.validateCheckout(checkout.invoice_payload,{
        user:checkout.from.id, amount:checkout.total_amount, currency:checkout.currency
      });
      await ctx.telegram.answerPreCheckoutQuery(checkout.id,valid,valid ? undefined : 'هذه الفاتورة غير متاحة. افتح التطبيق وابدأ من جديد.');
    });
    bot.on('successful_payment', ctx => {
      const payment = ctx.message.successful_payment;
      const player = membership.fulfill(payment.invoice_payload,{
        user:ctx.from.id, amount:payment.total_amount, currency:payment.currency,
        charge:payment.telegram_payment_charge_id
      },transaction);
      if (player) {
        io.to('player:'+player).emit('profile',profile(player));
        const room = rooms.get(memberships.get(player));
        if (room) send(room);
      }
    });
  }
  bot.catch(error => { console.error('تعذّر معالجة تحديث تليجرام.',error.name); throw error; });
  bot.launch({allowedUpdates:billingEnabled ? ['message','pre_checkout_query'] : ['message']}).catch(() => console.error('تعذّر تشغيل بوت تليجرام. تحقّق من الاتصال وإعدادات البوت.'));
  for (const signal of ['SIGINT','SIGTERM']) process.once(signal,() => {
    try { bot.stop(signal); } catch { /* Polling has not started. */ }
    http.close();
  });
}
