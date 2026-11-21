import express from 'express';
import { createServer } from 'node:http';
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { Server } from 'socket.io';
import { Telegraf, Markup } from 'telegraf';
import { items,glassRange,defaultAppearance,palettes,plans,rewards,successReward,referralPoints,specialOnly,premiumOnly } from './public/catalog.js';
import { createMembership,paidPrices } from './membership.js';
import { roomInviteUrl } from './public/invite.js';
import { createDatabase } from './database.js';

const { BOT_TOKEN, BOT_USERNAME, APP_SHORT_NAME, PUBLIC_URL } = process.env;
const telegramIdPattern = /^[1-9][0-9]{0,15}$/;
const adminSetting = (process.env.ADMIN_TELEGRAM_IDS || '')
  .replace(/[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g,'')
  .replace(/[٠-٩]/g,digit=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
  .replace(/[۰-۹]/g,digit=>String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
  .trim().replace(/^["']|["']$/g,'');
const adminIds = adminSetting.split(/[\s,،]+/).filter(Boolean);
const admins = new Set(adminIds.filter(id=>telegramIdPattern.test(id)));
if (adminIds.some(id=>!telegramIdPattern.test(id))) {
  console.warn('ADMIN_TELEGRAM_IDS: تجاهل الخادم قيمة غير صالحة. أدخل معرّف تليجرام الرقمي.');
}
function adminAccess(id) {
  if (!telegramIdPattern.test(id)) return 'telegram-required';
  if (admins.has(id)) return 'enabled';
  if (!adminIds.length) return 'missing';
  return admins.size ? 'different-account' : 'invalid';
}
const bot = BOT_TOKEN ? new Telegraf(BOT_TOKEN) : null;
const dev = process.env.NODE_ENV !== 'production' &&
  (process.env.DEV_GUESTS === '1' || (!BOT_TOKEN && process.env.DEV_GUESTS === undefined));
const db=await createDatabase();
await db.exec(`
  CREATE TABLE IF NOT EXISTS referrals (
    invitee TEXT PRIMARY KEY, inviter TEXT NOT NULL, rewarded_room TEXT
  );
  CREATE INDEX IF NOT EXISTS referrals_inviter ON referrals(inviter);
  CREATE TABLE IF NOT EXISTS referral_codes(player TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE);
  CREATE TABLE IF NOT EXISTS telegram_students(id TEXT PRIMARY KEY,name TEXT NOT NULL,handle TEXT);
  CREATE TABLE IF NOT EXISTS banned_students(id TEXT PRIMARY KEY, banned_by TEXT NOT NULL, banned_at BIGINT NOT NULL);
  CREATE TABLE IF NOT EXISTS players(id TEXT PRIMARY KEY, points INTEGER DEFAULT 0, streak INTEGER DEFAULT 0,
    last_day TEXT, inventory TEXT DEFAULT '{}', equipped TEXT DEFAULT '{}');
  CREATE TABLE IF NOT EXISTS results(room TEXT, player TEXT, status TEXT, reward INTEGER, minutes INTEGER,
    date TEXT DEFAULT '', goal_done INTEGER, forgiven INTEGER DEFAULT 0, old_streak INTEGER DEFAULT 0,
    PRIMARY KEY(room,player));
  CREATE INDEX IF NOT EXISTS results_player_date ON results(player,date);
  CREATE TABLE IF NOT EXISTS live_rooms(id TEXT PRIMARY KEY,state TEXT NOT NULL,updated_at BIGINT NOT NULL);
  CREATE TABLE IF NOT EXISTS point_grants(
    id TEXT PRIMARY KEY,player TEXT NOT NULL,amount INTEGER NOT NULL,remaining INTEGER NOT NULL,
    expires_at BIGINT NOT NULL,created_by TEXT NOT NULL,created_at BIGINT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS point_grants_player_expiry ON point_grants(player,expires_at);
  CREATE TABLE IF NOT EXISTS room_pairs(room TEXT PRIMARY KEY,first_player TEXT NOT NULL,second_player TEXT NOT NULL,started_at BIGINT NOT NULL);
  CREATE INDEX IF NOT EXISTS room_pairs_players ON room_pairs(first_player,second_player);
  CREATE TABLE IF NOT EXISTS outcome_views(room TEXT NOT NULL,player TEXT NOT NULL,seen_at BIGINT NOT NULL,PRIMARY KEY(room,player));
  CREATE TABLE IF NOT EXISTS pending_direct_invites(recipient TEXT PRIMARY KEY,room TEXT NOT NULL,sender TEXT NOT NULL,minutes INTEGER NOT NULL,created_at BIGINT NOT NULL);
`);
try{await db.exec('ALTER TABLE players ADD COLUMN tour_seen INTEGER NOT NULL DEFAULT 0');}catch(error){if(!/duplicate|already exists/i.test(error.message))throw error;}
const app = express();
export const http = createServer(app);
const io = new Server(http, { pingInterval:4000, pingTimeout:4000 });
const rooms = new Map();
const memberships = new Map();
const newRoomCode=()=>{let code;do{code=randomBytes(4).toString('hex').toUpperCase();}while([...rooms.values()].some(room=>room.code===code));return code;};
const minute = 60000;
const validDuration=value=>Number.isInteger(value)&&value>=5&&value<=180&&value%5===0;
const sessionBreak=value=>value<=25?5:value<=50?10:value<=90?12:value<=120?15:20;
export const clock = { now: Date.now };
const membership = await createMembership(db,() => clock.now());
const billingEnabled = Boolean(bot && Object.values(paidPrices).some(Boolean));
const fail = (message) => { throw new Error(message); };
const query=(sql,...args)=>db.query(sql,...args);
const run=(sql,...args)=>db.run(sql,...args);
const transaction=fn=>db.transaction(fn);

// Marathon tickets were replaced by membership access. Refund any remaining inventory once.
for(const player of await db.all('SELECT id,inventory FROM players')) {
  const inventory=JSON.parse(player.inventory||'{}');
  if(inventory.marathon>0){await run('UPDATE players SET points=points+?,inventory=? WHERE id=?',inventory.marathon*items.marathon[2],JSON.stringify({...inventory,marathon:undefined}),player.id);}
}

const isBanned=async id=>Boolean(await query('SELECT 1 FROM banned_students WHERE id=?',id));
const findStudents=(phrase)=>db.all(`SELECT id,name,handle FROM telegram_students
  WHERE ?='' OR id=? OR lower(name) LIKE ? OR coalesce(handle,'') LIKE ? ORDER BY name,id LIMIT 30`,phrase,phrase,'%'+phrase+'%','%'+phrase+'%');
const bannedMessage = 'حُظر هذا الحساب من استخدام ميثاق.';
async function expirePointGrants(player) {
  const condition=player?' AND player=?':'';
  const args=player?[clock.now(),player]:[clock.now()];
  const expired=await db.all(`SELECT player,sum(remaining) AS amount FROM point_grants WHERE expires_at<=? AND remaining>0${condition} GROUP BY player`,...args);
  if(!expired.length)return [];
  await transaction(async()=>{
    for(const row of expired){const amount=Number(row.amount);await run('UPDATE players SET points=CASE WHEN points>? THEN points-? ELSE 0 END WHERE id=?',amount,amount,row.player);}
    await run(`DELETE FROM point_grants WHERE expires_at<=?${condition}`,...args);
  });
  return expired.map(row=>row.player);
}
async function consumeTemporaryPoints(player,amount){
  let left=amount;
  const grants=await db.all('SELECT id,remaining FROM point_grants WHERE player=? AND expires_at>? AND remaining>0 ORDER BY expires_at,created_at',player,clock.now());
  for(const grant of grants){if(!left)break;const used=Math.min(left,Number(grant.remaining));await run('UPDATE point_grants SET remaining=remaining-? WHERE id=?',used,grant.id);left-=used;}
}
await expirePointGrants();
setInterval(async()=>{try{for(const id of await expirePointGrants())await updatePlayer(id);}catch(error){console.error('تعذّر إنهاء النقاط المؤقتة.',error.message);}},60000).unref();
async function updatePlayer(id) {
  if (!await query('SELECT 1 FROM players WHERE id=?',id)) return;
  io.to('player:'+id).emit('profile',await profile(id));
  const room = rooms.get(memberships.get(id));
  if (room) await send(room);
}

async function canRefer(id, inviter) {
  return id!==inviter && telegramIdPattern.test(id) && telegramIdPattern.test(inviter) &&
    !await query("SELECT 1 FROM results WHERE player=? AND status='success' LIMIT 1",id);
}

async function referralCode(id) {
  let row = await query('SELECT code FROM referral_codes WHERE player=?',id);
  while (!row) {
    const code = 'REF-'+randomBytes(5).toString('hex').toUpperCase();
    await run('INSERT INTO referral_codes(player,code) VALUES(?,?) ON CONFLICT DO NOTHING',id,code);
    row = await query('SELECT code FROM referral_codes WHERE player=?',id);
  }
  return row.code;
}

async function analytics(id) {
  const now = clock.now();
  const days = Array.from({length:7},(_,i)=>new Date(now-(6-i)*86400000).toISOString().slice(0,10));
  const [activity,outbound,code,linked,leaders]=await Promise.all([
    db.all(`SELECT substr(date,1,10) AS day, sum(minutes) AS minutes FROM results WHERE player=? AND status='success' AND date>=? GROUP BY day`,id,days[0]),
    query('SELECT count(*) AS invited,count(rewarded_room) AS rewarded FROM referrals WHERE inviter=?',id),
    query('SELECT code FROM referral_codes WHERE player=?',id),
    query('SELECT 1 FROM referrals WHERE invitee=?',id),
    db.all(`SELECT pairs.first_player,pairs.second_player,pairs.sessions,coalesce(a.name,'طالب ميثاق') AS first_name,coalesce(b.name,'طالب ميثاق') AS second_name FROM (SELECT first_player,second_player,count(*) AS sessions FROM room_pairs GROUP BY first_player,second_player ORDER BY sessions DESC LIMIT 10) pairs LEFT JOIN telegram_students a ON a.id=pairs.first_player LEFT JOIN telegram_students b ON b.id=pairs.second_player ORDER BY pairs.sessions DESC`)
  ]);
  return {
    weekly: days.map(day=>({day,minutes:Number(activity.find(entry=>entry.day===day)?.minutes || 0)})),
    referrals: { invited:Number(outbound.invited),rewarded:Number(outbound.rewarded),code:code?.code,linked:Boolean(linked) },
    leaderboard:leaders.map(row=>({...row,sessions:Number(row.sessions)}))
  };
}

async function profile(id, includeAnalytics=true) {
  const [player,stats,history,plan,cosmetics,appearance,referral,analysis,pointExpiry]=await Promise.all([
    query('SELECT * FROM players WHERE id=?',id),
    query(`SELECT count(*) FILTER (WHERE status='success') AS completed,coalesce(sum(minutes) FILTER (WHERE status='success'),0) AS minutes,count(*) FILTER (WHERE status='left' AND forgiven=0) AS left FROM results WHERE player=?`,id),
    db.all('SELECT * FROM results WHERE player=? ORDER BY date DESC LIMIT 20',id),
    membership.planStatus(id),membership.cosmetics(id),membership.appearance(id),
    query('SELECT count(*) AS referrals FROM referrals WHERE rewarded_room IS NOT NULL AND (inviter=? OR invitee=?)',id,id),
    includeAnalytics?analytics(id):Promise.resolve(null),
    db.all('SELECT remaining,expires_at FROM point_grants WHERE player=? AND expires_at>? AND remaining>0 ORDER BY expires_at',id,clock.now())
  ]);
  const today = new Date(clock.now()).toISOString().slice(0,10);
  const yesterday = new Date(clock.now()-86400000).toISOString().slice(0,10);
  const streak = [today,yesterday].includes(player.last_day) ? player.streak : 0;
  if (plan.tier!=='free') appearance.custom = await membership.customPalette(id);
  const inventory = JSON.parse(player.inventory);
  const equipped = JSON.parse(player.equipped);
  for(const slot of ['theme','decoration','celebration','title','frame'])if(equipped[slot]&&!items[equipped[slot]])delete equipped[slot];
  if (plan.tier === 'free') {
    for (const slot of ['title','frame']) if (!cosmetics[equipped[slot]]) delete equipped[slot];
    if (!items[equipped.theme] || !inventory[equipped.theme]) delete equipped.theme;
    if (!inventory[equipped.decoration]) delete equipped.decoration;
    if (palettes[appearance.palette]?.premium) appearance.palette = 'emerald';
    appearance.transparency = glassRange.defaultValue;
  }
  if (equipped.title && equipped.frame) delete equipped.frame;
  return { ...player, tourSeen:Boolean(player.tour_seen), streak, inventory, equipped, plan, cosmetics, appearance, now:clock.now(),
    admin:admins.has(id), adminAccess:adminAccess(id), prices:billingEnabled && !id.startsWith('guest:') ? paidPrices : {},
    referralBonus:Number(referral.referrals)*referralPoints,
    ...(analysis||{}), pointGrants:pointExpiry.map(row=>({amount:Number(row.remaining),expiresAt:Number(row.expires_at)})),pointExpiry:pointExpiry[0]?.expires_at?Number(pointExpiry[0].expires_at):null,completed:Number(stats.completed),minutes:Number(stats.minutes),left:Number(stats.left),
    reliability: Number(stats.completed)+Number(stats.left) ? Math.round(100*Number(stats.completed)/(Number(stats.completed)+Number(stats.left))) : 100, history };
}

async function use(id, item) {
  const { inventory } = await profile(id);
  if (!inventory[item]) fail('هذا العنصر غير متوفر في مخزونك.');
  inventory[item]--;
  await run('UPDATE players SET inventory=? WHERE id=?', JSON.stringify(inventory), id);
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
    return { id: String(user.id), name: [user.first_name,user.last_name].filter(Boolean).join(' '), photo:user.photo_url, handle:user.username?.toLowerCase() };
  }
  if (dev && typeof auth.guest === 'string' && /^[a-f0-9-]{36}$/.test(auth.guest)) {
    return { id: 'guest:'+auth.guest, name: String(auth.name || 'ضيف ميثاق').trim().slice(0,32) || 'ضيف ميثاق' };
  }
  fail('افتح ميثاق التركيز من تطبيق تليجرام.');
}

const roomSaveTimes=new WeakMap();
async function saveRoom(room,force=false) {
  if(!force&&clock.now()-(roomSaveTimes.get(room)||0)<5000)return;
  roomSaveTimes.set(room,clock.now());
  await run(`INSERT INTO live_rooms(id,state,updated_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,updated_at=excluded.updated_at`,room.id,JSON.stringify(room),clock.now());
}

async function send(room) {
  io.to(room.id).emit('room',{...room,now:clock.now(),members:room.members.map(member=>({...member,equipped:member.equipped||{}}))});
  saveRoom(room).catch(error=>console.error('تعذّر حفظ الغرفة.',error.message));
}

async function finish(room, leaving) {
  if (room.phase !== 'active') return;
  const now = clock.now();
  const rewarded = new Set();
  await transaction(async() => {
    for (const p of room.members) {
      const current = await profile(p.id,false);
      const status = !leaving ? 'success' : leaving === p.id ? 'left' : 'steadfast';
      const reward = status === 'success' ? successReward : status === 'left' ? -Math.min(rewards.withdrawal,current.points) : rewards.steadfast;
      const today = new Date(now).toISOString().slice(0,10);
      const streak = status === 'success' ? current.streak + Number(current.last_day !== today) : status === 'left' ? 0 : current.streak;
      if(reward<0)await consumeTemporaryPoints(p.id,-reward);
      await run('UPDATE players SET points=points+?, streak=?, last_day=? WHERE id=?', reward, streak, status === 'success' ? today : current.last_day, p.id);
      const date = new Date(now).toISOString().replace('T',' ').slice(0,19);
      await run('INSERT INTO results(room,player,status,reward,minutes,old_streak,date) VALUES(?,?,?,?,?,?,?) ON CONFLICT(room,player) DO NOTHING',room.id,p.id,status,reward,room.minutes,current.streak,date);
      if (status==='success' && current.completed===0) {
        const referral = await query('SELECT inviter FROM referrals WHERE invitee=? AND rewarded_room IS NULL',p.id);
        if (referral) {
          await run('UPDATE referrals SET rewarded_room=? WHERE invitee=?',room.id,p.id);
          await run('UPDATE players SET points=points+? WHERE id IN (?,?)',referralPoints,p.id,referral.inviter);
          rewarded.add(referral.inviter);
        }
      }
    }
  });
  room.phase = 'outcome';
  room.outcomeType=leaving?'withdrawal':'success';
  room.finished = now;
  delete room.breakUntil;
  await saveRoom(room,true);
  await Promise.all([...new Set([...room.members.map(p=>p.id),...rewarded])].map(async player=>io.to('player:'+player).emit('profile',await profile(player))));
  await send(room);
  for(const member of room.members){if(io.sockets.adapter.rooms.get('player:'+member.id)?.size)await run('INSERT INTO outcome_views(room,player,seen_at) VALUES(?,?,?) ON CONFLICT(room,player) DO NOTHING',room.id,member.id,clock.now());}
}

async function tick(room, now) {
  if (room.phase !== 'active') return;
  if (now >= room.endAt) return finish(room);
  if (now < room.startsAt || now < room.pauseUntil) return;
  await send(room);
}

let ticking=false;
setInterval(async() => {
  if(ticking)return; ticking=true;
  const now = clock.now();
  try { for (const [id,room] of rooms) {
    if ((room.finished && now-room.finished > 86400000) || (room.phase === 'lobby' && now-room.created > 86400000)) {
      rooms.delete(id);
      for (const p of room.members) if (memberships.get(p.id) === id) memberships.delete(p.id);
      await run('DELETE FROM live_rooms WHERE id=?',id);
    } else await tick(room, now);
  }} finally {ticking=false;}
}, 1000).unref();

async function leaveWaitingRoom(room, id) {
  const playerRoom = 'player:'+id;
  if (room?.phase !== 'lobby') return;
  if (room.members[0].id === id) {
    for (const member of room.members) {
      memberships.delete(member.id);
      io.to('player:'+member.id).emit('room',null);
    }
    io.in(room.id).socketsLeave(room.id);
    rooms.delete(room.id);
    await run('DELETE FROM live_rooms WHERE id=?',room.id);
    return;
  }
  room.members = room.members.filter(p => p.id !== id);
  for (const p of room.members) p.ready = false;
  memberships.delete(id);
  io.in(playerRoom).socketsLeave(room.id);
  io.to(playerRoom).emit('room',null);
  if (!room.members.length){rooms.delete(room.id);await run('DELETE FROM live_rooms WHERE id=?',room.id);}else await send(room);
}

async function dismissOutcome(room,id){
  if(room?.phase!=='outcome')return;
  room.dismissed ||= [];
  if(!room.dismissed.includes(id))room.dismissed.push(id);
  await run('INSERT INTO outcome_views(room,player,seen_at) VALUES(?,?,?) ON CONFLICT(room,player) DO NOTHING',room.id,id,clock.now());
  memberships.delete(id);
  const playerRoom='player:'+id;
  io.in(playerRoom).socketsLeave(room.id);
  io.to(playerRoom).emit('room',null);
  if(room.members.every(member=>room.dismissed.includes(member.id))){rooms.delete(room.id);await run('DELETE FROM live_rooms WHERE id=?',room.id);}
  else await saveRoom(room,true);
}

for(const row of await db.all('SELECT state FROM live_rooms')){
  try{const room=JSON.parse(row.state);if(room?.id&&room?.members){const changed=!/^[A-F0-9]{8}$/.test(room.code);if(changed)room.code=newRoomCode();await Promise.all(room.members.map(async member=>{delete member.exitAt;delete member.checkUntil;delete member.nextCheck;delete member.activity;member.equipped=JSON.parse((await query('SELECT equipped FROM players WHERE id=?',member.id))?.equipped||'{}');if(!room.dismissed?.includes(member.id))memberships.set(member.id,room.id);}));rooms.set(room.id,room);if(changed)await saveRoom(room,true);}}catch{/* Ignore corrupt room snapshots. */}
}

io.use(async(socket,next) => {
  try {
    const user = authenticate(socket.handshake.auth);
    if (await isBanned(user.id)) fail(bannedMessage);
    socket.data.user = user;
    next();
  } catch (error) { next(error); }
});
io.on('connection', async(socket) => {
  const user = socket.data.user;
  const { id } = user;
  await Promise.all([
    run('INSERT INTO players(id) VALUES(?) ON CONFLICT(id) DO NOTHING',id),
    telegramIdPattern.test(id)?run(`INSERT INTO telegram_students(id,name,handle) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,handle=excluded.handle`,id,user.name,user.handle||null):Promise.resolve(),
    telegramIdPattern.test(id)?referralCode(id):Promise.resolve()
  ]);
  const playerRoom = 'player:'+id;
  socket.join(playerRoom);
  const current = () => rooms.get(memberships.get(id));
  const previous = current();
  if (previous) {
    const alreadySeen=previous.phase==='outcome'&&(await query('SELECT 1 FROM outcome_views WHERE room=? AND player=?',previous.id,id)||clock.now()-Number(previous.finished||0)>60000);
    if(alreadySeen)await dismissOutcome(previous,id);
    else{
      socket.join(previous.id);
      await tick(previous,clock.now());
      await send(previous);
      if(previous.phase==='outcome')await run('INSERT INTO outcome_views(room,player,seen_at) VALUES(?,?,?) ON CONFLICT(room,player) DO NOTHING',previous.id,id,clock.now());
    }
  }
  const syncProfile=async()=>io.to(playerRoom).emit('profile',await profile(id));
  const isPaid=async player=>(await membership.planStatus(player)).tier!=='free';
  const initialProfile=await profile(id,false);
  socket.emit('hello',{user,profile:initialProfile,bot:BOT_USERNAME,shortName:APP_SHORT_NAME});
  const pendingInvite=await query('SELECT * FROM pending_direct_invites WHERE recipient=?',id);
  if(pendingInvite){
    const invitedRoom=rooms.get(pendingInvite.room);
    if(invitedRoom?.phase==='lobby'&&invitedRoom.members.length===1){
      socket.emit('directInvite',{code:invitedRoom.id,name:pendingInvite.sender,minutes:Number(pendingInvite.minutes)});
    }
    await run('DELETE FROM pending_direct_invites WHERE recipient=?',id);
  }
  analytics(id).then(details=>socket.connected&&socket.emit('profile',{...initialProfile,...details,now:clock.now()})).catch(error=>console.error('تعذّر تحميل تفاصيل الحساب.',error.message));

  function action(event, fn) {
    socket.on(event, async(payload, ack) => {
      if (typeof ack !== 'function') return;
      try { const result=await fn(payload??{}); ack(result&&typeof result==='object'?{ok:true,...result}:{ok:true}); } catch (error) { console.error(event,error);ack({ error:error.message }); }
    });
  }
  function adminAction(event, fn) {
    socket.on(event,async(payload,ack) => {
      if (typeof ack!=='function') return;
      if (!admins.has(id)) return ack({error:'هذه الصفحة للمشرفين.'});
      try { ack(await fn(payload||{})); } catch (error) { console.error(event,error);ack({error:error.message}); }
    });
  }
  async function adminStudent(row) {
    await expirePointGrants(row.id);
    const [balance,temporary]=await Promise.all([query('SELECT points FROM players WHERE id=?',row.id),query('SELECT coalesce(sum(remaining),0) AS points,min(expires_at) AS nearest FROM point_grants WHERE player=? AND expires_at>? AND remaining>0',row.id,clock.now())]);
    return {...row,points:Number(balance?.points||0),temporaryPoints:Number(temporary.points||0),temporaryUntil:temporary.nearest?Number(temporary.nearest):null,plan:await membership.planStatus(row.id),banned:await isBanned(row.id),admin:admins.has(row.id)};
  }
  adminAction('adminList', async({search}) => {
    const phrase = typeof search==='string' ? search.trim().replace(/^@/,'').toLowerCase().slice(0,80) : '';
    const rows = await findStudents(phrase);
    if (telegramIdPattern.test(phrase) && !rows.some(row=>row.id===phrase)) rows.unshift({id:phrase,name:'حساب جديد'});
    return {students:await Promise.all(rows.map(adminStudent)),codes:await membership.codes()};
  });
  adminAction('adminGrant', async({student,plan}) => {
    if (typeof student!=='string' || !telegramIdPattern.test(student) || !Object.hasOwn(plans,plan)) fail('اختر حسابًا وباقة صالحة.');
    if (await isBanned(student)) fail('ارفع الحظر قبل تفعيل العضوية.');
    if ((await membership.planStatus(student)).tier==='special') fail('سبيشل مفعّلة لهذا الحساب مدى الحياة.');
    await membership.grant(student,plan);
    await updatePlayer(student);
    return {ok:true};
  });
  adminAction('adminRevoke', async({student}) => {
    if (typeof student!=='string' || !telegramIdPattern.test(student)) fail('اختر حسابًا صالحًا.');
    await membership.revoke(student);
    await updatePlayer(student);
    return {ok:true};
  });
  adminAction('adminPoints', async({student,points,validDays=0}) => {
    if (typeof student!=='string' || !telegramIdPattern.test(student) || !Number.isSafeInteger(points) || points<=0 || !Number.isSafeInteger(validDays) || validDays<0 || validDays>365) {
      fail('اكتب عدد نقاط صحيحًا أكبر من صفر.');
    }
    const balance = Number((await query('SELECT points FROM players WHERE id=?',student))?.points||0);
    if (!Number.isSafeInteger(balance+points)) fail('الرصيد بعد الإضافة يتجاوز الحد المسموح.');
    await transaction(async()=>{
      await run(`INSERT INTO players(id,points) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET points=players.points+excluded.points`,student,points);
      if(validDays)await run('INSERT INTO point_grants(id,player,amount,remaining,expires_at,created_by,created_at) VALUES(?,?,?,?,?,?,?)',randomUUID(),student,points,points,clock.now()+validDays*86400000,id,clock.now());
    });
    await updatePlayer(student);
    return {ok:true};
  });
  adminAction('adminRemovePoints',async({student,points})=>{
    if(typeof student!=='string'||!telegramIdPattern.test(student)||!Number.isSafeInteger(points)||points<=0)fail('اكتب عدد نقاط صحيحًا أكبر من صفر.');
    const balance=Number((await query('SELECT points FROM players WHERE id=?',student))?.points||0);
    const removed=Math.min(balance,points);
    await transaction(async()=>{await consumeTemporaryPoints(student,removed);await run('UPDATE players SET points=points-? WHERE id=?',removed,student);});
    await updatePlayer(student);return {ok:true,removed};
  });
  adminAction('adminBan', async({student,banned}) => {
    if (typeof student!=='string' || !telegramIdPattern.test(student) || typeof banned!=='boolean') fail('اختر حسابًا صالحًا.');
    if (admins.has(student)) fail('لا يمكن حظر حساب أحد المشرفين.');
    if (banned) {
      await run('INSERT INTO banned_students(id,banned_by,banned_at) VALUES(?,?,?) ON CONFLICT(id) DO NOTHING',student,id,clock.now());
      io.to('player:'+student).emit('banned',bannedMessage);
      io.in('player:'+student).disconnectSockets(true);
      await leaveWaitingRoom(rooms.get(memberships.get(student)),student);
    } else await run('DELETE FROM banned_students WHERE id=?',student);
    return {ok:true};
  });
  adminAction('adminCode', async({plan}) => {
    if (!Object.hasOwn(plans,plan)) fail('اختر باقة صالحة.');
    return {code:await membership.createCode(id,plan)};
  });
  action('redeemCode', async({code}) => {
    if (!telegramIdPattern.test(id)) fail('افتح التطبيق من تليجرام لتفعيل الكود.');
    const normalized = typeof code==='string' ? code.trim().toUpperCase() : '';
    if (!/^MTHQ-[A-F0-9]{16}$/.test(normalized)) fail('الكود غير صالح.');
    if (!await membership.redeemCode(id,normalized)) fail('الكود مستخدم أو حسابك مفعّل بسبيشل.');
    await updatePlayer(id);
  });
  action('startTrial',async()=>{
    if(!telegramIdPattern.test(id))fail('التجربة المجانية متاحة لحسابات تليجرام فقط.');
    if(!await membership.startTrial(id))fail('استخدمت التجربة المجانية سابقًا أو لديك عضوية فعّالة.');
    await updatePlayer(id);
  });
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
  action('claimReferral', async({code}) => {
    const normalized = typeof code==='string' ? code.trim().toUpperCase() : '';
    if (!/^REF-[A-F0-9]{10}$/.test(normalized)) fail('اكتب كود الدعوة الذي يبدأ بـ REF-.');
    const inviter = (await query('SELECT player FROM referral_codes WHERE code=?',normalized))?.player;
    if (!inviter || await isBanned(inviter)) fail('كود الدعوة غير متاح.');
    if (id===inviter) fail('استخدم كود صديقك.');
    const linked = await query('SELECT inviter FROM referrals WHERE invitee=?',id);
    if (linked?.inviter===inviter) return syncProfile();
    if (linked) fail('هذا الحساب مرتبط بدعوة سابقة.');
    if (!await canRefer(id,inviter)) fail('أدخل كود الدعوة قبل إكمال جلستك الأولى.');
    await run('INSERT INTO referrals(invitee,inviter) VALUES(?,?)',id,inviter);
    await syncProfile();
    io.to('player:'+inviter).emit('profile',await profile(inviter));
  });
  action('refreshProfile', async() => {
    await syncProfile();
    if (current()) await send(current());
  });
  action('completeTour',async()=>{await run('UPDATE players SET tour_seen=1 WHERE id=?',id);});
  action('appearance', async({mode,palette,transparency}) => {
    if (!['dark','light'].includes(mode) || !Object.hasOwn(palettes,palette)) fail('المظهر غير متاح.');
    if (palettes[palette].premium && !await isPaid(id)) fail('هذا اللون متاح مع برو وسبيشل.');
    if (transparency !== undefined) {
      if (!await isPaid(id)) fail('التحكم بالشفافية متاح مع برو وسبيشل.');
      if (!Number.isInteger(transparency) || transparency < glassRange.min || transparency > glassRange.max) {
        fail('درجة الشفافية غير متاحة.');
      }
    }
    if (palette==='custom' && !await membership.customPalette(id)) fail('احفظ ألوانك المخصصة أولًا.');
    await membership.setAppearance(id,mode,palette,transparency);
    await syncProfile();
  });
  action('resetAppearance',async()=>{
    const row=await query('SELECT equipped FROM players WHERE id=?',id);
    const equipped=JSON.parse(row?.equipped||'{}');
    delete equipped.decoration;
    await transaction(async()=>{
      await membership.setAppearance(id,defaultAppearance.mode,defaultAppearance.palette,defaultAppearance.transparency);
      await run('UPDATE players SET equipped=? WHERE id=?',JSON.stringify(equipped),id);
    });
    const room=current();const member=room?.members.find(entry=>entry.id===id);if(member)member.equipped={...equipped};
    await syncProfile();if(room)await send(room);
  });

  action('customPalette', async({fill,first,second}) => {
    if (!await isPaid(id)) fail('الألوان المخصصة متاحة مع برو وسبيشل.');
    const isHex = value=>typeof value==='string' && /^#[0-9a-f]{6}$/i.test(value);
    if (!['solid','gradient'].includes(fill) || !isHex(first) || !isHex(second)) fail('اختر ألوانًا صالحة.');
    await transaction(async() => {
      await membership.setCustomPalette(id,{fill,first,second});
      await membership.setAppearance(id,(await membership.appearance(id)).mode,'custom');
    });
    await syncProfile();
  });
  let nextInvoiceAt = 0;
  socket.on('membershipInvoice', async (payload, ack) => {
    if (typeof ack !== 'function') return;
    const plan = payload?.plan;
    if (!billingEnabled || !Object.hasOwn(plans,plan) || !paidPrices[plan] || id.startsWith('guest:')) {
      return ack({error:'شراء هذه العضوية غير متاح الآن.'});
    }
    const currentPlan=await membership.planStatus(id);
    if (currentPlan.tier === 'special') return ack({error:'عضوية سبيشل مفعّلة مدى الحياة.'});
    if (plan==='pro'&&currentPlan.tier==='pro') return ack({error:'يمكنك الاشتراك في برو مجددًا بعد انتهاء المدة الحالية.'});
    if (clock.now() < nextInvoiceAt) return ack({error:'انتظر قليلًا ثم حاول مجددًا.'});
    nextInvoiceAt = clock.now()+10000;
    const title = 'ميثاق التركيز · '+plans[plan].title;
    try {
      const url = await bot.telegram.callApi('createInvoiceLink',{
        title, description:'تفعيل مزايا العضوية لمدة '+plans[plan].duration+'.',
        payload:await membership.newInvoice(id,plan), currency:'XTR', provider_token:'',
        prices:[{label:title,amount:paidPrices[plan]}]
      },{signal:AbortSignal.timeout(8000)});
      nextInvoiceAt = 0;
      ack({url});
    } catch {
      ack({error:'تعذّر فتح فاتورة نجوم تليجرام.'});
    }
  });
  async function enter(room, goal) {
    const old = current();
    if (old && old.phase !== 'outcome') fail('أكمل غرفتك الحالية أولًا.');
    if (old) io.in(playerRoom).socketsLeave(old.id);
    const equipped=JSON.parse((await query('SELECT equipped FROM players WHERE id=?',id))?.equipped||'{}');
    const tier=(await membership.planStatus(id)).tier;
    room.members.push({ id, name:user.name, photo:user.photo, goal, ready:false, activity:clock.now(),equipped,tier });
    memberships.set(id,room.id);
    io.in(playerRoom).socketsJoin(room.id);
    await send(room);
  }
  const goalText = (value) => {
    const goal = String(value || '').trim().slice(0,160);
    return goal || 'جلسة تركيز';
  };
  action('create', async({ minutes, goal, pact }) => {
    if (!validDuration(minutes)) fail('اختر مدة بين ٥ و١٨٠ دقيقة بمضاعفات ٥.');
    if (minutes >= 120 && !await isPaid(id)) fail('جلسات ١٢٠ و١٨٠ دقيقة للمشتركين فقط.');
    const roomId=randomUUID().replaceAll('-','');
    const room = { id:roomId, code:newRoomCode(), phase:'lobby', created:clock.now(),
      minutes, pact:String(pact || '').trim().slice(0,160), members:[] };
    rooms.set(room.id,room);
    await enter(room,goalText(goal));
  });
  action('join', async({ code, goal }) => {
    const normalized = typeof code==='string' ? code.trim().toUpperCase() : '';
    const room = rooms.get(normalized.toLowerCase()) || (/^[A-F0-9]{8}$/.test(normalized)
      ? [...rooms.values()].find(room=>room.code===normalized) : null);
    if(room?.members.some(member=>member.id===id)){
      memberships.set(id,room.id);io.in(playerRoom).socketsJoin(room.id);await send(room);return {own:true};
    }
    if (!room || room.phase !== 'lobby' || room.members.length >= 2) fail('الغرفة ممتلئة أو انتهت صلاحية الدعوة.');
    const inviter = room.members[0].id;
    await enter(room,goalText(goal));
    if (await canRefer(id,inviter)) {
      const attached = await run('INSERT INTO referrals(invitee,inviter) VALUES(?,?) ON CONFLICT(invitee) DO NOTHING',id,inviter);
      if (attached.changes) { await syncProfile(); io.to('player:'+inviter).emit('profile',await profile(inviter)); }
    }
  });
  let nextDirectInvite = 0;
  action('directInvite', async({handle}) => {
    const room = current();
    if (room?.phase!=='lobby' || room.members.length!==1) fail('الدعوة متاحة عندما تكون الغرفة بانتظار شريك.');
    const target = typeof handle==='string' ? handle.trim().replace(/^@/,'').toLowerCase() : '';
    if (!/^[a-z0-9_]{5,32}$/.test(target)) fail('اكتب اسم مستخدم تليجرام.');
    const recipient=await query('SELECT id FROM telegram_students WHERE handle=?',target);
    if(!recipient)fail('هذا الحساب لم يفتح ميثاق من قبل. أرسل له الرابط أولًا.');
    if(recipient.id===id)fail('لا يمكنك دعوة حسابك نفسه.');
    const recipientRoom=rooms.get(memberships.get(recipient.id));
    if (recipientRoom && recipientRoom.phase!=='outcome') fail('شريكك موجود في غرفة أخرى.');
    if (clock.now() < nextDirectInvite) fail('انتظر قليلًا قبل إرسال دعوة أخرى.');
    nextDirectInvite = clock.now()+5000;
    const targetRoom='player:'+recipient.id;
    if(io.sockets.adapter.rooms.get(targetRoom)?.size){
      io.to(targetRoom).emit('directInvite',{code:room.id,name:user.name,minutes:room.minutes});
      await run('DELETE FROM pending_direct_invites WHERE recipient=?',recipient.id);
    }else{
      await run(`INSERT INTO pending_direct_invites(recipient,room,sender,minutes,created_at) VALUES(?,?,?,?,?) ON CONFLICT(recipient) DO UPDATE SET room=excluded.room,sender=excluded.sender,minutes=excluded.minutes,created_at=excluded.created_at`,recipient.id,room.id,user.name,room.minutes,clock.now());
    }
  });
  action('leaveLobby', () => leaveWaitingRoom(current(),id));
  action('dismissOutcome',()=>dismissOutcome(current(),id));
  action('outcomeBreak',async()=>{
    const room=current();
    if(room?.phase!=='outcome'||room.outcomeType!=='success')fail('الاستراحة غير متاحة الآن.');
    if(!room.breakUntil||room.breakUntil<=clock.now())room.breakUntil=clock.now()+sessionBreak(room.minutes)*minute;
    await saveRoom(room,true);await send(room);
  });
  action('ready', async() => {
    const room = current();
    if (room?.phase !== 'lobby') return;
    const p = room.members.find(p => p.id === id);
    const starting = room.members.length === 2 && room.members.every(m => m.id === id || m.ready);
    if (starting && room.members.some(member => !io.sockets.adapter.rooms.get('player:'+member.id)?.size)) {
      fail('بانتظار عودة شريكك للاتصال.');
    }
    if (starting && room.minutes >= 120 && !await isPaid(room.members[0].id)) fail('تحتاج إلى عضوية فعّالة لبدء هذه الجلسة.');
    p.ready = true;
    if (starting) {
      room.phase = 'active';
      room.startsAt = clock.now()+3000;
      room.endAt = room.startsAt+room.minutes*minute;
      const pairIds=room.members.map(member=>member.id).sort();
      await run('INSERT INTO room_pairs(room,first_player,second_player,started_at) VALUES(?,?,?,?) ON CONFLICT(room) DO NOTHING',room.id,pairIds[0],pairIds[1],clock.now());
    }
    await send(room);
  });
  async function active() {
    const room = current();
    if (room) await tick(room,clock.now());
    if (room?.phase !== 'active') fail('الجلسة غير نشطة.');
    return [room,room.members.find(p => p.id === id),room.members.find(p => p.id !== id)];
  }
  action('presence',()=>{});
  action('activity',()=>{});
  action('withdraw', async() => { const [room] = await active(); await finish(room,id); });
  action('signal', async({item}) => {
    const room = current();
    if(premiumOnly.has(item)&&!await isPaid(id))fail('هذا التفاعل متاح مع برو وسبيشل.');
    if (item === 'horn' && (room?.phase !== 'outcome' || !(await profile(id)).history.some(r=>r.room===room.id && r.status==='success'))) fail('بوق الفوز متاح بعد إتمام الجلسة.');
    const [,p,partner] = item === 'horn' ? [room, room.members.find(m=>m.id===id),room.members.find(m=>m.id!==id)] : await active();
    if (clock.now()-(p.lastSignal || 0)<10000) fail('انتظر قليلًا قبل إرسال تنبيه آخر.');
    if (['zap','coffee','horn'].includes(item)) await use(id,item);
    else fail('تفاعل غير صالح.');
    p.lastSignal=clock.now();
    io.to('player:'+partner.id).emit('signal',item);
    if(['zap','coffee','horn'].includes(item))io.to(room.id).emit('giftMoment',{item,from:p.name,to:partner.name});
    await saveRoom(room);await syncProfile();
  });
  action('requestPause', async() => {
    const [room] = await active();
    if (clock.now() < room.startsAt || ((!await isPaid(id) || room.premiumPauseUsed) && !(await profile(id)).inventory.pause) || room.pauseUntil > clock.now() || room.pauseRequest?.until > clock.now()) fail('الاستراحة غير متاحة الآن.');
    room.pauseRequest = { id, until:clock.now()+30000 };
    await send(room);
  });
  action('answerPause', async({accept}) => {
    const [room] = await active();
    const request = room.pauseRequest;
    if (!request || request.id === id || request.until < clock.now()) fail('انتهت صلاحية طلب الاستراحة.');
    if (accept === true) {
      if (await isPaid(request.id) && !room.premiumPauseUsed) room.premiumPauseUsed = true;
      else await use(request.id,'pause');
      room.pauseUntil = clock.now()+3*minute;
      room.endAt += 3*minute;
      io.to('player:'+request.id).emit('profile',await profile(request.id));
    }
    room.pauseRequest = null;
    await send(room);
  });
  action('buy', async({item,quantity=1}) => {
    if (!Object.hasOwn(items,item) || item==='marathon') fail('العنصر غير موجود.');
    const [category,,cost] = items[item];
    const { points,inventory,cosmetics } = await profile(id);
    if(specialOnly.has(item)&&(await membership.planStatus(id)).tier!=='special')fail('هذا الثيم حصري لعضوية سبيشل.');
    if(premiumOnly.has(item)&&!await isPaid(id))fail('هذا المنتج متاح مع برو وسبيشل.');
    if(category===4&&!await isPaid(id))fail('ثيمات التخصصات متاحة مع برو وسبيشل.');
    if ([1,2,4].includes(category) && await isPaid(id)) fail('العنصر متاح لك ضمن العضوية.');
    const total = cost*quantity;
    const stackable = category===0 || category===3;
    if (!Number.isSafeInteger(quantity) || quantity<1 || (!stackable && quantity!==1) || !Number.isSafeInteger(total)) fail('الكمية غير صالحة.');
    if (points < total) fail('رصيدك لا يكفي لهذا العنصر.');
    if (([1,4,5].includes(category) && inventory[item]) || (category === 2 && cosmetics[item])) fail('هذا العنصر موجود في مخزونك.');
    const nextCount = category===2 ? 1 : (inventory[item] || 0)+quantity;
    if (!Number.isSafeInteger(nextCount)) fail('الكمية غير صالحة.');
    inventory[item] = nextCount;
    await transaction(async() => {
      if (category === 2) await membership.grantCosmetic(id,item);
      await consumeTemporaryPoints(id,total);
      await run('UPDATE players SET points=points-?,inventory=? WHERE id=?',total,JSON.stringify(inventory),id);
    });
    await syncProfile();
  });
  action('equip', async({item}) => {
    if (!Object.hasOwn(items,item) || ![1,2,4,5].includes(items[item][0])) fail('العنصر غير متاح.');
    const { inventory,cosmetics } = await profile(id);
    if(specialOnly.has(item)&&(await membership.planStatus(id)).tier!=='special')fail('هذا الثيم حصري لعضوية سبيشل.');
    if(premiumOnly.has(item)&&!await isPaid(id))fail('هذا المنتج متاح مع برو وسبيشل.');
    const category = items[item][0];
    if(category===4&&!await isPaid(id))fail('ثيمات التخصصات متاحة مع برو وسبيشل.');
    if (!([1,2,4].includes(category)&&await isPaid(id)) && !(category === 2 ? cosmetics[item] : inventory[item])) fail('العنصر غير متاح.');
    const equipped = JSON.parse((await query('SELECT equipped FROM players WHERE id=?',id)).equipped);
    const slot = category === 5 ? 'celebration' : category === 4 ? 'decoration' : category === 1 ? 'theme' : item === 'frame' ? 'frame' : 'title';
    if (equipped[slot]===item) equipped[slot]=null;
    else {
      if (category===2) delete equipped[slot==='title'?'frame':'title'];
      equipped[slot]=item;
    }
    await run('UPDATE players SET equipped=? WHERE id=?',JSON.stringify(equipped),id);
    const room=current();const member=room?.members.find(entry=>entry.id===id);if(member)member.equipped={...equipped};
    await syncProfile();
    if (current()) await send(current());
  });
  action('result', async({done}) => {
    const room = current();
    if (room?.phase !== 'outcome' || typeof done !== 'boolean') return;
    await run("UPDATE results SET goal_done=? WHERE room=? AND player=? AND status='success'",Number(done),room.id,id);
    await syncProfile();
  });
  action('protect', async({item}) => {
    if (!['shield','eraser'].includes(item)) fail('عنصر غير صالح.');
    if(premiumOnly.has(item)&&!await isPaid(id))fail('هذا المنتج متاح مع برو وسبيشل.');
    const last = (await profile(id)).history[0];
    if (last?.status !== 'left' || (item === 'eraser' && last.forgiven)) fail('لا يوجد انسحاب حديث لمعالجته.');
    await transaction(async() => {
      if (item === 'shield' && (!last.old_streak || (await profile(id)).streak)) fail('لا توجد سلسلة لاستعادتها.');
      await use(id,item);
      if (item === 'shield') await run('UPDATE players SET streak=? WHERE id=?',last.old_streak,id);
      else await run('UPDATE results SET forgiven=1 WHERE room=? AND player=?',last.room,id);
    });
    await syncProfile();
  });
});

app.get('/health',async(_req,res)=>{try{await query('SELECT 1 AS ok');res.json({ok:true,database:db.kind,guests:dev});}catch{res.status(503).json({ok:false,database:db.kind});}});
app.use((req,res,next)=>{
  if(/\.(?:css|html|js)$/.test(req.path))res.set('Cache-Control','no-store, max-age=0');
  next();
});
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
      const valid = !await isBanned(String(checkout.from.id)) && await membership.validateCheckout(checkout.invoice_payload,{
        user:checkout.from.id, amount:checkout.total_amount, currency:checkout.currency
      });
      await ctx.telegram.answerPreCheckoutQuery(checkout.id,valid,valid ? undefined : 'هذه الفاتورة غير متاحة. افتح التطبيق وابدأ من جديد.');
    });
    bot.on('successful_payment', async ctx => {
      const payment = ctx.message.successful_payment;
      const player = await membership.fulfill(payment.invoice_payload,{
        user:ctx.from.id, amount:payment.total_amount, currency:payment.currency,
        charge:payment.telegram_payment_charge_id
      });
      if (player) await updatePlayer(player);
    });
  }
  bot.catch(error => { console.error('تعذّر معالجة تحديث تليجرام.',error.name); throw error; });
  bot.launch({allowedUpdates:billingEnabled ? ['message','pre_checkout_query'] : ['message']}).catch(() => console.error('تعذّر تشغيل بوت تليجرام. تحقّق من الاتصال وإعدادات البوت.'));
  for (const signal of ['SIGINT','SIGTERM']) process.once(signal,async() => {
    try { bot.stop(signal); } catch { /* Polling has not started. */ }
    http.close();
    await db.close();
  });
}
