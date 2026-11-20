import { items,sections,palettes,plans,rewards,successReward,storeArt,defaultAppearance,glassRange,durations,referralPoints,specialties,breakMinutes,specialOnly } from './catalog.js';
import { readRoomInvite,readReferralInvite,roomInviteUrl,telegramInviteUrl } from './invite.js';

const telegramLaunch = /(?:^#|[&?])tgWebApp/.test(location.hash) || new URLSearchParams(location.search).has('tgWebAppStartParam')
  || sessionStorage.getItem('__telegram__initParams');
if (telegramLaunch && !window.Telegram?.WebApp) {
  await new Promise(resolve => {
    const script = document.createElement('script');
    script.src = 'https://telegram.org/js/telegram-web-app.js';
    script.onload = script.onerror = resolve;
    document.head.append(script);
  });
}
const tg = window.Telegram?.WebApp;
tg?.ready();
if (tg?.initData) {
  tg.expand();
  const inset = () => {
    for (const edge of ['top','bottom']) {
      const system = tg.safeAreaInset?.[edge] || 0;
      const content = tg.contentSafeAreaInset?.[edge] || 0;
      document.documentElement.style.setProperty('--tg-'+edge,Math.max(system,content)+'px');
    }
  };
  tg.onEvent('safeAreaChanged',inset);
  tg.onEvent('contentSafeAreaChanged',inset);
  inset();
}
const page = document.querySelector('#page');
const dialog = document.querySelector('#dialog');
const notice = document.querySelector('#notice');
dialog.addEventListener('close',()=>{
  appearanceOpen=false;
  glassPreview=undefined;
  applyGlass();
});
dialog.addEventListener('cancel',event=>{ if (dialog.querySelector('#check-deadline')) event.preventDefault(); });
const launch = {startParam:tg?.initDataUnsafe?.start_param,hash:location.hash,search:location.search};
let invite = readRoomInvite(launch);
let referralLaunch = readReferralInvite(launch);
const icon = (name) => '<i aria-hidden="true" data-icon="'+name+'" style="--icon:url(/icons/'+name+'.svg)"></i>';
document.querySelectorAll('i[data-icon]').forEach(i => i.style.setProperty('--icon','url(/icons/'+i.dataset.icon+'.svg)'));
const esc = (v) => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num = (v) => Number(v || 0).toLocaleString('ar',{numberingSystem:'arab'});
const remainingTime=(value,now=Date.now())=>{const minutes=Math.max(0,Math.ceil((value-now)/60000));const days=Math.floor(minutes/1440);const hours=Math.floor((minutes%1440)/60);const rest=minutes%60;return [days&&num(days)+' يوم',hours&&num(hours)+' ساعة',!days&&!hours&&num(rest)+' دقيقة'].filter(Boolean).join(' و ');};
let room, socket, user, profile, bot, shortName, clockOffset = 0, chosen = 25, tab = 'home', category = 0, goal = '', pact = '', inviteDismissed = false;
let viewKey, noticeTimeout, revisited, lastActivity = 0, lastCheck, audio, ambience;
let preparingInvite = false, incomingInvite;
let appearanceOpen = false, checkoutOpen = false, expiryTimer, glassPreview, glassRequest = 0;
const isPaid = () => ['pro','special'].includes(profile?.plan?.tier);
let purchaseBusy = false;
let activityDay;
let adminData, adminSearch = '', adminBusy = false, blocked = false;
let appearanceRequest = 0, appearanceSaveTimer, visualUpdatePending = false;
const guestId = sessionStorage.getItem('methaq-guest') || Array.from(crypto.getRandomValues(new Uint8Array(18)), b=>b.toString(16).padStart(2,'0')).join('');
sessionStorage.setItem('methaq-guest',guestId);
const name = new URLSearchParams(location.search).get('name') || 'ضيف ميثاق';

function toast(message) {
  notice.textContent = message;
  clearTimeout(noticeTimeout);
  noticeTimeout = setTimeout(() => notice.textContent = '',3800);
}
function emit(event,payload={}) {
  if (!socket?.connected) return toast('الاتصال غير متاح حاليًا.');
  socket.timeout(5000).emit(event,payload,(error,response) => {
    if (error || response?.error) toast(response?.error || 'تعذر الاتصال بالخادم.');
    else if (['buy','equip','protect'].includes(event)) toast('تم تحديث مخزونك.');
    else if (event==='customPalette') toast('تم حفظ ألوانك.');
    else if (event==='appearance') toast('تم حفظ المظهر.');
    else if (event==='directInvite') toast('أُرسلت الدعوة داخل ميثاق.');
    else if (event==='redeemCode') toast('تم تفعيل عضويتك.');
    else if (event==='startTrial') toast('بدأت تجربة برو المجانية لمدة ٣ أيام.');
    else if (event==='claimReferral') toast('تم تسجيل دعوة صديقك.');
  });
}
function avatar(person) {
  const classes = 'avatar'+(person?.equipped?.frame ? ' gold-frame':'');
  const photo = person?.photo;
  return photo && /^https:\/\//i.test(photo)
    ? '<img class="'+classes+'" src="'+esc(photo)+'" alt="" referrerpolicy="no-referrer">'
    : '<span class="'+classes+'" aria-hidden="true">'+(esc(person?.name?.[0]) || icon('user-round'))+'</span>';
}
function account() {
  const p = profile || {};
  document.querySelector('#admin-toggle').hidden = !p.admin || blocked;
  const membershipControl=document.querySelector('#upgrade-top');
  const tier=p.plan?.tier;
  membershipControl.hidden=false;
  membershipControl.classList.toggle('is-member',Boolean(tier&&tier!=='free'));
  membershipControl.innerHTML=tier&&tier!=='free'?icon(plans[tier].icon)+' '+plans[tier].title:icon('crown')+' ترقية';
  const temporary=(p.pointGrants||[]).map(grant=>`<small class="point-expiry" data-point-expiry="${grant.expiresAt}" data-point-amount="${grant.amount}">−${num(grant.amount)} خلال <b>${remainingTime(grant.expiresAt)}</b></small>`).join('');
  const accountElement = document.querySelector('#account');
  const content = `<span class="metric streak-stat"><span class="metric-icon">${icon('flame')}</span><span>السلسلة <strong>${num(p.streak)}</strong></span></span>
    <span class="metric points-stat"><span class="metric-icon">${icon('sparkles')}</span><span>النقاط <strong>${num(p.points)}</strong>${temporary}</span></span>`;
  if (accountElement.dataset.content !== content) {
    accountElement.innerHTML = content;
    accountElement.dataset.content = content;
  }
}
const button = (action,label,type='secondary',symbol='',value='') => `<button type="button" class="${type}" data-action="${action}" data-value="${value}">${symbol ? icon(symbol):''}${label}</button>`;
const heading = (title,caption='') => `<div class="heading"><h1>${title}</h1>${caption?'<p>'+caption+'</p>':''}</div>`;
const isInvite = () => invite && !inviteDismissed && (!room || revisited);
const durationAllowed = (minutes) => minutes<120 || isPaid();
const dialProgress = (minutes) => minutes<=25 ? Math.max(0,minutes) : Math.min(100,25+(minutes-25)*75/155);
function decorationStyle() {
  const key = profile?.equipped?.decoration;
  return key ? 'data-decoration="'+key+'" style="--decoration:'+storeArt[key]+'"' : '';
}
function decorationIcon() {
  const key = profile?.equipped?.decoration;
  return key ? '<span class="decoration-art" aria-hidden="true">'+icon(items[key][3])+'</span>' : '';
}
function studentProfile() {
  const equipped = profile?.equipped;
  return `<section class="panel student-profile" ${decorationStyle()}>
    ${decorationIcon()}
    ${avatar({...user,equipped})}<div><strong>${esc(user?.name || 'ضيف ميثاق')}</strong>
    <small>${items[equipped?.title]?.[1] || 'رفيق تركيز'}</small>
    </div></section>`;
}
function pendingInvite() {
  if (!incomingInvite || isInvite()) return '';
  return `<section class="panel direct-banner"><p><strong>${esc(incomingInvite.name)}</strong> يدعوك لجلسة ${num(incomingInvite.minutes)} دقيقة.</p>
    <div class="actions">${button('acceptInvite','انضمام','primary','user-round-plus')}${button('dismissInvite','تجاهل','plain')}</div></section>`;
}
function dial(text,label,progress=0) {
  return `<div class="orbit"><div class="dial" style="--progress:${progress}"><div class="dial-content">${icon('lock-keyhole')}<strong class="digits" id="digits">${text}</strong><small id="dial-label">${label}</small></div></div>
  <span class="satellite one">${icon('user-round')}</span><span class="satellite two">${icon('user-round')}</span></div>`;
}
function home() {
  const joining = isInvite();
  return `<div class="inner focus-home">
    ${studentProfile()}
    ${pendingInvite()}
    ${joining ? `<section class="intro"><h1>لديك دعوة للتركيز</h1><p>انضم مباشرة، ويمكنك كتابة هدف مختصر إن رغبت.</p></section>` : `
    <section class="panel preview home-timer" ${decorationStyle()} aria-labelledby="focus-timer-title">
      <div class="preview-top"><h1 id="focus-timer-title">مؤقت التركيز</h1><span class="tag"><span class="dot"></span> جلسة ثنائية</span></div>
      ${decorationIcon()}
      ${dial(chosen+':00','مدة الجلسة',dialProgress(chosen))}
      <p class="preview-note">${icon('users')} يبدأ المؤقت بعد موافقة الطرفين</p>
    </section>
    <div class="durations" role="group" aria-label="مدة الجلسة">${durations.map(m=>`<button type="button" class="duration ${m===chosen?'on':''}" data-action="duration" data-value="${m}" aria-pressed="${m===chosen}"><strong>${num(m)}</strong> دقيقة${!durationAllowed(m)?icon('lock-keyhole'):''}</button>`).join('')}</div>`}
    <form class="panel form-main" id="session-form"><div class="panel-title"><span class="tile-icon">${icon('sliders-horizontal')}</span><div><h2>${joining?'انضم إلى الجلسة':'إعداد الجلسة'}</h2></div></div>
    <label class="field">هدف الجلسة <small class="optional">اختياري</small><input maxlength="160" name="goal" placeholder="ماذا ستنجز في هذه الجلسة؟" value="${esc(goal)}"></label>
    <button class="primary wide create-room-cta">${joining?icon('log-in'):'<span class="cta-cube" aria-hidden="true"><i></i><b></b><em></em></span>'}<span>${joining?'الانضمام إلى الغرفة':'ابدأ ميثاقك وأنشئ غرفة'}</span>${joining?'':'<small>وادعُ شريكك للتركيز معًا</small>'}</button>
    ${joining?button('ignore','العودة للرئيسية','plain'):''}</form>
    ${joining?'':`<form id="join-code-form" class="panel join-code"><label class="field">عندك رمز غرفة؟<input name="code" dir="ltr" maxlength="10" placeholder="رمز الغرفة" required></label><button class="secondary">${icon('log-in')} انضم بالرمز</button></form>`}
    <div class="pact-bar"><span class="tile-icon">${icon('shield-check')}</span><div><strong>ميثاق الجلسة</strong><p>عند الإتمام تمنح المنصة كل طرف ${num(rewards.achievement)} نقطة إنجاز.</p></div><span class="tag">${icon('sparkles')} مكافأة</span></div></div>`;
}
function person(p, active=false) {
  if (!p) return `<article class="panel person">${avatar()}<div><h3>شريك التركيز</h3><p>بانتظار الانضمام</p></div></article>`;
  const status = active ? p.exitAt ? '<span style="color:var(--danger)">حاول الخروج! <b data-exit="'+p.exitAt+'"></b></span>'
    : p.idle ? '<span class="gold">خامل</span>' : '<span class="dot pulse"></span> يركز الآن'
    : p.ready ? 'وافق على الميثاق' : 'بانتظار الموافقة';
  return `<article class="panel person">${avatar(p)}<div><h3>${esc(p.name)} ${p.id===user?.id?' <small class="muted">(أنت)</small>':''}</h3>
  ${p.equipped?.title?'<small class="gold">'+items[p.equipped.title][1]+'</small>':''}<p>${esc(p.goal)}</p><span class="tag">${status}</span></div></article>`;
}
const pair = (active) => '<div class="pair">'+person(room.members.find(p=>p.id===user?.id),active)+person(room.members.find(p=>p.id!==user?.id),active)+'</div>';
function lobby() {
  const me = room.members.find(p=>p.id===user?.id);
  return `<div class="inner">${heading('غرفة الانتظار','جلسة تركيز لمدة '+num(room.minutes)+' دقيقة')}<div class="stack">${pair(false)}
  ${invitePanel()}
  <section class="panel"><h2>ميثاق الجلسة</h2><p class="bodycopy">أتعهد بالبقاء حاضرًا والتركيز على هدفي. تمنح المنصة كل طرف ${num(rewards.achievement)} نقطة إنجاز عند الإتمام. عند الانسحاب تُحرق حتى ٢٠ نقطة من رصيد المنسحب، وتمنح المنصة شريكه ${num(rewards.steadfast)} نقطة صمود.</p></section>
  ${me?.ready?'<p class="tag">وافقت على الميثاق. بانتظار شريكك.</p>':button('ready','أوافق وأنا مستعد','primary','lock-keyhole')}
  ${button('leaveLobby','مغادرة الغرفة','plain','log-out')}</div></div>`;
}
function active() {
  const partner = room.members.find(p=>p.id!==user?.id);
  const inventory = profile?.inventory || {};
  const request = room.pauseRequest?.until > serverNow() && room.pauseRequest;
  return `<div class="inner theme-${profile?.equipped?.theme || 'default'}">${heading('جلسة التركيز','ابقَ حاضرًا حتى نهاية المؤقت.')}<div class="stack">
  <div class="room-code-hero"><span>${icon('hash')} رمز الغرفة</span><strong dir="ltr">${esc(room.code)}</strong>${button('copyCode','نسخ','plain','copy')}</div>
  <section class="panel preview active-dial" ${decorationStyle()}>${decorationIcon()}${dial('00:00','الوقت المتبقي')}</section>${pair(true)}
  ${request ? '<section class="panel actions">'+(request.id===user.id?'بانتظار موافقة شريكك على الاستراحة.':'شريكك يطلب استراحة لمدة ٣ دقائق. '+button('answerPause','أوافق','primary','','yes')+button('answerPause','متابعة الجلسة','secondary','','no'))+'</section>':''}
  <section class="panel stack"><div class="actions" aria-label="أصوات الخلفية">${[['rain','مطر'],['cafe','مقهى'],['white','ضوضاء بيضاء']].map(([k,v])=>button('sound',v,ambience===k?'primary':'secondary','volume-2',k)).join('')}</div>
  <div class="actions">${partner?.idle?button('signal','إرسال تنبيه اهتزاز','secondary','zap','nudge'):''}
  ${inventory.zap?button('signal','صعقة التركيز','secondary','zap','zap'):''}${inventory.coffee?button('signal','إهداء كوب قهوة','secondary','coffee','coffee'):''}
  ${inventory.pause || (isPaid() && !room.premiumPauseUsed)?button('requestPause','استراحة محارب','secondary','timer-reset'):''}${button('withdraw','انسحاب','plain','log-out')}</div></section></div></div>`;
}
const labels = { success:'جلسة مكتملة', steadfast:'صمود الشريك', left:'انسحاب' };
function outcome() {
  const result = profile?.history.find(r=>r.room===room.id);
  if (!result) return '';
  const succeeded = result.status==='success';
  const left = result.status==='left';
  return `<div class="inner">${heading(succeeded?'أتممتما الميثاق!':left?'انتهت الجلسة بانسحابك':'صمدت حتى النهاية',succeeded?'أحسنتما الالتزام بجلسة التركيز.':left?'يمكنك بدء جلسة جديدة عندما تكون مستعدًا.':'منحتك المنصة '+num(result.reward)+' نقطة تعويض صمود.') }<div class="stack">
  <section class="panel stack"><strong class="mint">${icon('sparkles')} ${result.reward>0?'+':''}${num(result.reward)} نقطة</strong>
  ${succeeded ? `<p class="bodycopy">${result.reward===successReward ? num(rewards.achievement)+' نقطة إنجاز · ' : ''}سلسلة الالتزام ${num(profile.streak)} يوم</p><h2>هل أنجزت هدفك؟</h2><div class="actions">${button('result','نعم',result.goal_done===1?'primary':'secondary','','yes')}${button('result','ليس بعد',result.goal_done===0?'primary':'secondary','','no')}</div>
  ${button('shareCard','مشاركة بطاقة الإنجاز','primary','share-2')}${profile.inventory.horn?button('signal','بوق الفوز','secondary','megaphone','horn'):''}` : ''}
  ${left && profile.inventory.shield && result.old_streak && !profile.streak ? button('protect','استخدام درع الحماية','secondary','shield','shield'):''}
  </section>
  ${succeeded && room.breakUntil ? `<section class="panel break-card">
    <span class="tile-icon">${icon('timer-reset')}</span><div><h2>استراحة بعد التركيز</h2><p class="bodycopy">${num(breakMinutes[room.minutes])} دقيقة قبل جلستك التالية</p></div>
    <strong class="break-time" id="break-time" dir="ltr"></strong></section>`:''}
  ${button('reset','جلسة جديدة','secondary','plus')}</div></div>`;
}
const weekDay = new Intl.DateTimeFormat('ar-SA',{weekday:'short',timeZone:'UTC'});
const sessionDate = new Intl.DateTimeFormat('ar-SA',{day:'numeric',month:'short',calendar:'gregory',timeZone:'UTC'});
const dateFromKey = (value) => new Date(value+'T00:00:00Z');
function stats() {
  const p = profile || {};
  const values = [
    ['timer','دقائق التركيز',p.minutes,'teal'],
    ['circle-check','جلسات مكتملة',p.completed,'blue'],
    ['flame','أيام متتالية',p.streak,'amber']
  ];
  return `<div class="inner stats-page">${heading('إحصائياتك','تابع تقدّمك في جلسات التركيز.')}
    <div class="stats-metrics">${values.map(([symbol,label,value,tone])=>`<article class="panel stats-metric tone-${tone}">
      <span class="stats-icon">${icon(symbol)}</span><strong>${num(value)}</strong><span>${label}</span></article>`).join('')}</div>
    <div class="stats-overview">${referralCard(p)}${activityCard(p.weekly || [])}</div>
    <section class="panel leaderboard"><div class="stats-section-head"><span class="stats-icon">${icon('trophy')}</span><div><h2>ثنائيات الصدارة</h2><p class="bodycopy">أكثر شريكين دخلا جلسات تركيز معًا.</p></div></div>
      ${(p.leaderboard||[]).length?`<ol>${p.leaderboard.map((pair,index)=>`<li><span class="leader-rank">${num(index+1)}</span><div><strong>${esc(pair.first_name)} × ${esc(pair.second_name)}</strong><small>${num(pair.sessions)} جلسة معًا</small></div>${index===0?icon('crown'):''}</li>`).join('')}</ol>`:'<p class="bodycopy">ابدأوا الجلسات لتظهر الصدارة.</p>'}</section>
    <section class="panel stats-history">
      <div class="stats-section-head"><span class="stats-icon">${icon('history')}</span><h2>سجل الجلسات</h2></div>
      ${p.history?.length?`<ul>${p.history.map(r=>{
        const symbols = { success:'circle-check', steadfast:'shield', left:'log-out' };
        return `<li class="stats-history-row result-${r.status}"><span class="stats-icon">${icon(symbols[r.status])}</span>
          <div><strong>${labels[r.status]}</strong><small>${sessionDate.format(dateFromKey(r.date.slice(0,10)))} · ${num(r.minutes)} دقيقة</small></div>
          <span class="history-reward"><bdi>${r.reward>0?'+':''}${num(r.reward)}</bdi> نقطة</span></li>`;
      }).join('')}</ul>`:`<div class="stats-empty">${icon('clipboard-list')}<p>سجل الجلسات فارغ.</p>${button('goHome','ابدأ جلسة','secondary','arrow-left')}</div>`}
    </section></div>`;
}
function activityCard(week) {
  const total = week.reduce((sum,entry)=>sum+entry.minutes,0);
  const peak = Math.max(1,...week.map(entry=>entry.minutes));
  const selected = week.find(entry=>entry.day===activityDay);
  return `<section class="panel activity-card">
    <div class="stats-section-head"><span class="stats-icon">${icon('chart-no-axes-column')}</span><div><h2>نشاط التركيز</h2><p>آخر ٧ أيام</p></div></div>
    <div class="week-total"><strong>${num(total)}</strong> دقيقة</div>
    <div class="week-chart" role="group" aria-label="دقائق التركيز حسب اليوم">${week.map(entry=>{
      const day = weekDay.format(dateFromKey(entry.day));
      return `<button class="chart-day" type="button" data-action="activityDay" data-value="${entry.day}" aria-label="${day}، ${num(entry.minutes)} دقيقة" aria-pressed="${entry.day===activityDay}">
        <span class="chart-track"><span class="chart-bar" style="--bar-height:${entry.minutes/peak*100}%"></span></span><small>${day}</small></button>`;
    }).join('')}</div>
    <p class="chart-detail" aria-live="polite">${selected?sessionDate.format(dateFromKey(selected.day))+' · '+num(selected.minutes)+' دقيقة':total?'اضغط على يوم لعرض مدته.':'يظهر نشاطك هنا بعد أول جلسة مكتملة.'}</p>
  </section>`;
}
function referralCard(p) {
  const {code,invited=0,rewarded=0,linked} = p.referrals || {};
  const link = code && telegramInviteUrl({bot,shortName,code});
  return `<section class="panel referral-card">
    <div class="stats-section-head"><span class="stats-icon">${icon('gift')}</span><div><h2>دعوة الأصدقاء</h2><p>${num(referralPoints)} نقطة لك ولصديقك بعد أول جلسة مكتملة له.</p></div></div>
    ${code?`<div class="referral-code"><div><label for="my-referral-code">كودك الشخصي</label><input id="my-referral-code" dir="ltr" value="${esc(code)}" readonly></div>${button('copyReferralCode','نسخ الكود','secondary','copy')}</div>
      ${link?`<div class="actions referral-links">${button('shareReferral','شارك رابط الدعوة','primary','send')}${button('copyReferralLink','نسخ الرابط','plain','link-2')}</div>`:''}`:'<p class="bodycopy">افتح ميثاق من تليجرام للحصول على كودك.</p>'}
    <div class="referral-counts">
      <div><strong>${num(invited)}</strong><span>أصدقاء انضموا</span></div>
      <div><strong>${num(rewarded)}</strong><span>أكملوا أول جلسة</span></div>
      <div><strong>${num(p.referralBonus)}</strong><span>نقاط الدعوات</span></div>
    </div>
    ${code && !linked && !p.completed?`<details class="claim-referral"><summary>عندك كود من صديق؟</summary>
      <form id="claim-referral-form"><input aria-label="كود دعوة صديق" name="code" dir="ltr" maxlength="14" placeholder="REF-…" required>
      <button class="secondary">سجّل الكود</button></form></details>`:''}
  </section>`;
}
async function shareReferral(copyOnly) {
  const code = profile?.referrals?.code;
  if (!code) return;
  const link = telegramInviteUrl({bot,shortName,code});
  if (!link) return;
  if (!copyOnly && tg?.initData) {
    const share = new URL('https://t.me/share/url');
    share.searchParams.set('url',link);
    share.searchParams.set('text','انضم إلى ميثاق التركيز وسجّل دعوتك.');
    try { tg.openTelegramLink(share.href); return; } catch { /* Fall through to clipboard. */ }
  }
  try {
    await navigator.clipboard.writeText(link);
    toast('نُسخ رابط دعوتك.');
  } catch {
    modal('رابط دعوتك','اضغط مطولًا على الرابط لنسخه.',
      '<input class="referral-link-field" value="'+esc(link)+'" dir="ltr" readonly>'+button('close','إغلاق','secondary'));
  }
}
function memberships() {
  const active = profile?.plan?.tier;
  const until = profile?.plan?.until;
  const features={pro:['جلسات حتى ١٨٠ دقيقة','كل ثيمات التخصصات','ألوان مخصصة وشفافية الزجاج','استراحة محارب في كل جلسة'],special:['كل مزايا برو مدى الحياة','ثيم سبيشل الأبدي الحصري','شارة سبيشل بجانب اسمك','كل الثيمات المستقبلية دون شراء']};
  return `<section class="membership-section stack" id="memberships" aria-labelledby="membership-title">
    <div><h2 id="membership-title">عضويات ميثاق</h2><p class="bodycopy">اختر العضوية المناسبة لك، أو جرّب برو مجانًا لمدة ٣ أيام مرة واحدة.</p></div>
    ${active==='pro' && until ? `<div class="membership-countdown"><span>${profile.plan.trial?'تجربة برو':'برو'} مفعّل حتى ${new Date(until).toLocaleDateString('ar-SA')}</span><strong data-membership-until="${until}">${remainingTime(until,serverNow())}</strong></div>` : ''}
    <div class="store-grid">${Object.entries(plans).map(([key,plan])=>{
      const price = profile?.prices?.[key];
      const status = active===key ? 'مفعّل' : active==='special' ? 'مشمول مع سبيشل' : '';
      const action = price && active!=='special' && !(key==='pro'&&active==='pro') ? button('checkout','اختيار '+plan.title,'primary','star',key) : '';
      return `<article class="panel plan-card" style="--art:${plan.color}"><span class="art-plain">${icon(plan.icon)}</span>
        <h3>${plan.title}</h3><p>${plan.duration}</p><ul class="plan-features">${features[key].map(feature=>`<li>${icon('circle-check')} ${feature}</li>`).join('')}</ul>
        ${status?'<p class="mint">'+status+'</p>':''}
        ${active!=='special'?'<p class="gold">'+(price?num(price)+' نجمة تليجرام':'الشراء غير متاح حاليًا')+'</p>':''}
        ${action}${key==='pro'?'<small class="muted">دفعة واحدة لكل ٣٠ يومًا</small>':''}</article>`;
    }).join('')}</div>
    ${active==='free'&&profile?.plan?.trialAvailable?button('startTrial','ابدأ تجربة برو المجانية · ٣ أيام','secondary','timer'):''}</section>`;
}
function plansPage(){return `<div class="inner store-page">${heading('الاشتراكات','مزايا أكثر لجلسات تركيز أهدأ وأطول.')}${memberships()}</div>`;}
function store() {
  const p = profile;
  return `<div class="inner store-page">${heading('متجر ميثاق','رصيدك الحالي '+num(p?.points)+' نقطة')}
  <form id="redeem-code-form" class="panel join-code redeem-code">
    <label class="field">كود العضوية<input name="code" dir="ltr" maxlength="21" placeholder="MTHQ-…" required></label>
    <button class="secondary">${icon('ticket-check')} فعّل الكود</button>
  </form>
  <div class="filters">${sections.map((x,i)=>button('filter',x,i===category?'selected':'','',i)).join('')}</div>
  ${shopItems(category)}</div>`;
}
function inventoryPage(){
  const owned=Object.entries(items).filter(([key,[group]])=>(group===2?Boolean(profile?.cosmetics?.[key]):(profile?.inventory?.[key]||0)>0)||Object.values(profile?.equipped||{}).includes(key));
  return `<div class="inner store-page">${heading('المخزون','كل مشترياتك وعناصرك في مكان واحد.')}
    ${owned.length?`<div class="store-grid inventory-grid">${owned.map(([key,[group,label,,symbol,desc]])=>{const count=profile?.inventory?.[key]||0;const equipped=Object.values(profile?.equipped||{}).includes(key);const expiry=profile?.cosmetics?.[key];return `<article class="panel inventory-item"><div class="inventory-visual" style="--art:${storeArt[key]}"><span class="art-orbit"></span>${icon(symbol)}${icon('sparkles')}</div><div class="inventory-copy"><h3>${label}</h3><p class="bodycopy">${desc}</p><span class="tag">${equipped?'مفعّل':expiry?'متاح حتى '+new Date(expiry).toLocaleDateString('ar-SA'):num(count)+' في المخزون'}</span></div>${[1,2,4].includes(group)?button('equip',equipped?'إلغاء التفعيل':'استخدم','secondary','power',key):button('useInventory','استخدم قطعة واحدة','primary','play',key)}</article>`;}).join('')}</div>`:'<section class="panel empty-state">'+icon('package-open')+'<h2>مخزونك فارغ</h2><p class="bodycopy">ستظهر هنا العناصر التي تشتريها من المتجر.</p></section>'}</div>`;
}
function themes() {
  const current = specialties[profile?.equipped?.decoration];
  return `<div class="inner store-page">${heading('الثيمات','غيّر لون المنصة ووضع العرض، واختر ثيم تخصصك.')}
  <section class="panel appearance-overview"><div><h2>الألوان ووضع العرض</h2>
    <p class="bodycopy">${profile?.appearance?.mode==='dark'?'ليلي':'نهاري'} · ${palettes[profile?.appearance?.palette || 'emerald'].label}</p></div>
    ${button('appearanceMenu','تعديل المظهر','secondary','palette')}</section>
  <h2 class="specialty-title">ثيمات التخصصات</h2>${current?'<p class="bodycopy">الثيم المفعّل · '+current[0]+'</p>':''}
  ${shopItems(4)}</div>`;
}
function shopItems(groupIndex) {
  const p = profile;
  return `<p class="bodycopy section-rule">${icon('layers')} ${[1,2,4].includes(groupIndex)?'في هذا القسم يُفعّل منتج واحد فقط.':'في هذا القسم يُستخدم منتج واحد في كل مرة.'}</p>
    <div class="store-grid">${Object.entries(items).filter(([key,x])=>key!=='marathon' && x[0]===groupIndex).map(([key,[group,label,cost,symbol,desc]])=>{
    const count = p?.inventory[key] || 0;
    const expires = p?.cosmetics?.[key];
    const collectible = [1,2,4].includes(group);
    const specialLocked=specialOnly.has(key)&&profile?.plan?.tier!=='special';
    const available = !specialLocked&&collectible && (isPaid() || (group===2 ? expires : count));
    const equipped = Object.values(p?.equipped || {}).includes(key);
    const detail = specialLocked?'حصري لعضوية سبيشل':collectible && isPaid() ? 'مشمول في العضوية' : group===2 && expires
      ? 'متاح حتى '+new Date(expires).toLocaleDateString('ar') : num(cost)+' نقطة'+(group===2?' · صالح ٣ أيام':count?' · في المخزون '+num(count):'');
    return `<article class="panel store-item">
      <div class="store-art art-${key}" style="--art:${storeArt[key]}"><span aria-hidden="true" class="art-orbit"></span>${icon(symbol)}${icon('sparkles')}</div>
      <h3>${label}</h3><p class="bodycopy">${desc}</p><span class="gold">${detail}</span>
      <div class="store-controls">${specialLocked?button('seePlans','عرض سبيشل','secondary','gem'):available?button('equip',equipped?'إلغاء التفعيل':'تفعيل',equipped?'primary':'secondary','',key):`
        <form class="buy-form" data-item="${key}">
          ${!collectible?`<label>الكمية <span class="quantity-stepper">${button('quantityMinus','−','plain','','')}<input name="quantity" type="number" min="1" step="1" value="1" required inputmode="numeric">${button('quantityPlus','+','plain','','')}</span></label>`:''}
          <button class="secondary" aria-label="شراء ${label}">${icon('shopping-cart')} شراء</button>
        </form>`}
      ${key==='eraser'&&count?button('protect','استخدام','plain','',key):''}</div></article>`;
  }).join('')}</div>`;
}

function purchasePreference() {
  return 'methaq.purchase-confirmation.'+(user?.id || guestId);
}
function purchasePrompt(item, quantity) {
  if (purchaseBusy) return;
  const [,label,price] = items[item];
  if (Number(localStorage.getItem(purchasePreference())) > Date.now()) return purchase(item,quantity);
  dialog.innerHTML = `<form id="confirm-purchase-form" class="stack purchase-warning" data-item="${item}" data-quantity="${quantity}">
    <span class="tile-icon">${icon('triangle-alert')}</span><h2>تأكيد عملية الشراء</h2>
    <p class="bodycopy">${label} × ${num(quantity)} · الإجمالي ${num(quantity*price)} نقطة</p>
    <label class="purchase-choice"><input name="skip" type="checkbox"> اشترِ مباشرة لمدة أسبوع دون عرض هذا التنبيه</label>
    <div class="actions"><button class="primary">تأكيد الشراء</button>${button('close','إلغاء','secondary')}</div>
  </form>`;
  if (!dialog.open) dialog.showModal();
}
async function purchase(item, quantity, skip=false) {
  if (purchaseBusy) return;
  if (!socket?.connected) return toast('الاتصال غير متاح حاليًا.');
  purchaseBusy = true;
  try {
    const result = await socket.timeout(5000).emitWithAck('buy',{item,quantity});
    if (result.error) throw new Error(result.error);
    if (skip) localStorage.setItem(purchasePreference(),Date.now()+7*86400000);
    toast('تم الشراء وتحديث مخزونك.');
  } catch (error) {
    toast(error.message || 'تعذّر إتمام الشراء.');
  } finally {
    purchaseBusy=false;
  }
}
dialog.addEventListener('submit',event=>{
  const form = event.target;
  if (form.id!=='confirm-purchase-form') return;
  event.preventDefault();
  const skip = new FormData(form).has('skip');
  dialog.close();
  purchase(form.dataset.item, Number(form.dataset.quantity),skip);
});

function adminPage() {
  if (!profile?.admin) return '';
  const {students=[],codes=[]} = adminData || {};
  return `<div class="inner admin-page">${heading('لوحة الإدارة','إدارة حسابات الطلاب وأكواد العضوية')}
    <div class="stack"><section class="panel stack"><h2>الطلاب</h2>
      <form id="admin-search-form" class="join-code"><label class="field">ابحث عن طالب<input name="search" value="${esc(adminSearch)}" placeholder="الاسم أو @username أو معرّف تليجرام"></label>
      <button class="secondary">${icon('search')} بحث</button></form>
      ${students.map(student=>{
        const plan = plans[student.plan.tier];
        const status = student.banned ? 'محظور' : plan?.title || 'مجاني';
        return `<article class="admin-row"><div><strong>${esc(student.name)}</strong>
        <p class="bodycopy">${esc(student.handle?'@'+student.handle+' · ':'')}${esc(student.id)} · ${status} · ${num(student.points)} نقطة</p>
        ${student.temporaryPoints?`<p class="bodycopy">${icon('clock-3')} ${num(student.temporaryPoints)} نقطة مؤقتة · أقرب انتهاء ${new Date(student.temporaryUntil).toLocaleDateString('ar-SA')}</p>`:''}</div>
        <form class="actions admin-student-form" data-student="${esc(student.id)}">
          ${!student.banned && student.plan.tier!=='special'?`<select name="plan" aria-label="الباقة"><option value="pro">برو</option><option value="special">سبيشل</option></select><button class="secondary" value="grant">${icon('circle-check')} فعّل</button>`:''}
          ${plan?button('confirmAdminRevoke','إزالة العضوية','danger','user-round-minus',student.id):''}
          ${!student.banned?`<input name="points" type="number" min="1" step="1" inputmode="numeric" placeholder="عدد النقاط" aria-label="عدد النقاط">
          <select name="validDays" aria-label="صلاحية النقاط"><option value="0">دائمة</option><option value="1">يوم واحد</option><option value="3">٣ أيام</option><option value="7">أسبوع</option><option value="14">أسبوعان</option><option value="30">شهر</option></select>
          <button class="secondary" value="points">${icon('sparkles')} إضافة</button><button class="danger" value="removePoints">${icon('circle-minus')} إزالة</button>`:''}
          ${!student.admin?`<button class="${student.banned?'secondary':'danger'}" value="${student.banned?'unban':'ban'}">${student.banned?'رفع الحظر':'حظر'}</button>`:''}
        </form></article>`;
      }).join('') || '<p class="bodycopy">'+(adminData?'لم تظهر حسابات مطابقة.':'جارٍ تحميل الحسابات…')+'</p>'}</section>
    <section class="panel stack"><h2>أكواد العضوية</h2><p class="bodycopy">كل كود يفعّل العضوية لحساب واحد.</p>
      <form id="admin-code-form" class="actions"><label>الباقة <select name="plan"><option value="pro">برو</option><option value="special">سبيشل</option></select></label>
      <button class="primary">${icon('ticket-plus')} أنشئ كودًا</button></form>
      ${codes.map(entry=>`<div class="admin-row"><div><code dir="ltr">${esc(entry.code)}</code><p class="bodycopy">${plans[entry.plan]?.title} · ${entry.redeemed_by?'مستخدم':'متاح'}</p></div>
      ${!entry.redeemed_by?button('adminCopy','نسخ الكود','secondary','copy',entry.code):''}</div>`).join('')}</section></div></div>`;
}

function changeAppearance(next) {
  if(!profile?.appearance)return;
  const previous={...profile.appearance};
  const request=++appearanceRequest;
  visualUpdatePending=true;
  profile.appearance={...profile.appearance,...next};
  applyAppearance();
  if(appearanceOpen&&dialog.open){
    dialog.querySelectorAll('[data-action="mode"]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.value===profile.appearance.mode)));
    dialog.querySelectorAll('[data-action="palette"]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.value===profile.appearance.palette)));
  }
  tg?.HapticFeedback?.selectionChanged();
  clearTimeout(appearanceSaveTimer);
  appearanceSaveTimer=setTimeout(async()=>{
    try{
      const response=await socket.timeout(5000).emitWithAck('appearance',{mode:profile.appearance.mode,palette:profile.appearance.palette});
      if(response.error)throw new Error(response.error);
      if(request===appearanceRequest)visualUpdatePending=false;
    }catch(error){
      if(request===appearanceRequest){visualUpdatePending=false;profile.appearance=previous;applyAppearance();openAppearance();}
      toast(error.message||'تعذّر حفظ المظهر.');
    }
  },120);
}
async function adminRequest(event,payload={}) {
  if (!profile?.admin || !socket?.connected || adminBusy) return;
  adminBusy = true;
  try {
    const result = await socket.timeout(5000).emitWithAck(event,payload);
    if (result.error) throw new Error(result.error);
    if (event!=='adminList') {
      toast(result.code?'تم إنشاء الكود.':'تم تحديث الحساب.');
    }
    const data = event==='adminList' ? result : await socket.timeout(5000).emitWithAck('adminList',{search:adminSearch});
    if (data.error) throw new Error(data.error);
    adminData = data;
    if (tab==='admin') render(true);
  } catch (error) {
    toast(error.message || 'تعذّر تحديث لوحة الإدارة.');
  } finally {
    adminBusy = false;
  }
}

function premiumDuration(minutes) {
  if (tg?.initData) tg.HapticFeedback?.selectionChanged();
  dialog.innerHTML = `<div class="stack upgrade-dialog">
    <span class="art-plain" style="--art:#f2bc57">${icon('crown')}</span>
    <h2>جلسة ${num(minutes)} دقيقة للمشتركين</h2>
    <p class="bodycopy">افتح جلسات التركيز الطويلة مع برو أو سبيشل.</p>
    <div class="actions">${button('seePlans','عرض الاشتراكات','primary','sparkles')}${button('close','رجوع','plain')}</div>
  </div>`;
  if (!dialog.open) dialog.showModal();
}

function adminAccessDetails() {
  const status = {
    enabled:'صلاحية الإدارة مفعّلة لهذا الحساب.',
    missing:'الخادم الحالي لم يستلم إعداد الإدارة. تحقق من نشر متغير ADMIN_TELEGRAM_IDS على خدمة Methaq.',
    invalid:'وصل متغير الإدارة إلى الخادم، لكن قيمته لا تحتوي على معرّف تليجرام صالح.',
    'different-account':'الخادم استلم إعداد الإدارة، لكن معرّف هذا الحساب غير موجود ضمن المشرفين.',
    'telegram-required':'افتح ميثاق من داخل تليجرام حتى يتحقق الخادم من معرّف حسابك.'
  }[profile?.adminAccess] || 'بانتظار اتصال الحساب بالخادم.';
  const id = user?.id;
  return `<details class="appearance-card admin-access"><summary>حالة صلاحية الإدارة</summary>
    <p class="bodycopy">${status}</p>
    ${id && /^[0-9]+$/.test(id) ? '<p class="bodycopy">معرّف الحساب الحالي <b dir="ltr">'+esc(id)+'</b></p>' : ''}</details>`;
}

function customFill({fill,first,second}) {
  return fill==='gradient' ? 'linear-gradient(130deg,'+first+','+second+')' : first;
}
function customPaletteForm(custom={fill:'gradient',first:'#94e8cc',second:'#9db9ff'}) {
  return `<form id="custom-palette-form" class="appearance-card custom-palette">
    <h3>ألواني المخصصة</h3>
    <label>نوع التعبئة <select name="fill"><option value="solid" ${custom.fill==='solid'?'selected':''}>لون ثابت</option>
      <option value="gradient" ${custom.fill==='gradient'?'selected':''}>تدرّج</option></select></label>
    <div class="actions"><label>اللون الأول <input name="first" type="color" value="${esc(custom.first)}"></label>
      <label id="custom-second" ${custom.fill==='solid'?'hidden':''}>اللون الثاني <input name="second" type="color" value="${esc(custom.second)}"></label></div>
    <div id="color-preview" class="custom-preview" style="background:${customFill(custom)}"></div>
    <button class="primary">${icon('palette')} احفظ الألوان</button>
  </form>`;
}
function readCustomForm(form) {
  const data = new FormData(form);
  return {fill:data.get('fill'),first:data.get('first'),second:data.get('second')};
}
dialog.addEventListener('input',event=>{
  const form = event.target.closest('#custom-palette-form');
  if (!form) return;
  const custom = readCustomForm(form);
  form.querySelector('#custom-second').hidden = custom.fill!=='gradient';
  form.querySelector('#color-preview').style.background = customFill(custom);
});
dialog.addEventListener('submit',async event=>{
  if (event.target.id!=='custom-palette-form') return;
  event.preventDefault();
  const custom=readCustomForm(event.target);
  const previous={...profile.appearance};
  visualUpdatePending=true;
  profile.appearance={...profile.appearance,palette:'custom',custom};
  applyAppearance();
  try{
    const response=await socket.timeout(5000).emitWithAck('customPalette',custom);
    if(response.error)throw new Error(response.error);
    visualUpdatePending=false;
    toast('تم حفظ ألوانك.');
  }catch(error){visualUpdatePending=false;profile.appearance=previous;applyAppearance();toast(error.message||'تعذّر حفظ الألوان.');}
});

async function toggleEquip(item) {
  if(!profile?.equipped||!items[item])return;
  const category=items[item][0];
  const slot=category===4?'decoration':category===1?'theme':item==='frame'?'frame':'title';
  const previous={...profile.equipped};
  profile.equipped={...profile.equipped,[slot]:profile.equipped[slot]===item?null:item};
  if(category===2&&profile.equipped[slot])delete profile.equipped[slot==='title'?'frame':'title'];
  visualUpdatePending=true;
  applyAppearance();render(true);tg?.HapticFeedback?.selectionChanged();
  try{
    const response=await socket.timeout(5000).emitWithAck('equip',{item});
    if(response.error)throw new Error(response.error);
    visualUpdatePending=false;toast('تم تفعيل الثيم.');
  }catch(error){visualUpdatePending=false;profile.equipped=previous;applyAppearance();render(true);toast(error.message||'تعذّر تفعيل الثيم.');}
}

function openAppearance() {
  if (dialog.open && !appearanceOpen) return;
  appearanceOpen = true;
  const appearance = profile?.appearance || defaultAppearance;
  dialog.innerHTML = `<div class="stack"><div class="appearance-head"><h2>مظهر المنصة</h2>${button('close','إغلاق','plain','x')}</div>
    <section class="appearance-card"><h3>وضع العرض</h3><div class="pair">${Object.entries({light:['نهاري','sun'],dark:['ليلي','moon']}).map(([mode,[label,symbol]])=>
      `<button type="button" class="mode-option ${mode}" data-action="mode" data-value="${mode}" aria-pressed="${mode===appearance.mode}">${icon(symbol)} ${label}</button>`).join('')}</div></section>
    <section class="appearance-card"><h3>الألوان</h3><div class="palette-grid">${Object.entries(palettes).filter(([key])=>key!=='custom' || profile?.appearance?.custom).map(([key,palette])=>{
      const locked = palette.premium && !isPaid();
      return `<button type="button" class="palette-option" data-action="palette" data-value="${key}" aria-pressed="${appearance.palette===key}">
        <span class="swatch" style="background:${key==='custom'?customFill(appearance.custom):palette.swatch}">${locked?icon('lock-keyhole'):''}</span>${palette.label}</button>`;
    }).join('')}</div>${!isPaid()?'<p class="bodycopy">الزمردي والأزرق متاحان للجميع. التدرجات والألوان الأخرى مع برو وسبيشل.</p>':''}</section>
    ${isPaid()?customPaletteForm(appearance.custom):''}
    <section class="appearance-card glass-settings">
      <label for="glass-range">${icon(isPaid()?'droplets':'lock-keyhole')} شفافية الزجاج <output id="glass-value" for="glass-range">${num(appearance.transparency)}٪</output></label>
      <input id="glass-range" type="range" min="${glassRange.min}" max="${glassRange.max}" value="${appearance.transparency}" ${isPaid()?'':'disabled aria-describedby="glass-lock"'}>
      ${isPaid()?'':'<p class="bodycopy" id="glass-lock">تحكّم بالشفافية مع برو وسبيشل.</p>'}
    </section>
    ${!isPaid() && room?.phase!=='active' ? button('seePlans','عرض العضويات','secondary','crown') : ''}
    ${adminAccessDetails()}</div>`;
  if (!dialog.open) dialog.showModal();
}

function applyGlass() {
  const transparency = glassPreview ?? profile?.appearance?.transparency ?? glassRange.defaultValue;
  document.documentElement.style.setProperty('--glass-transparency',transparency+'%');
}
dialog.addEventListener('input',event=>{
  if (event.target.id!=='glass-range' || !isPaid()) return;
  glassPreview = event.target.valueAsNumber;
  dialog.querySelector('#glass-value').value = num(glassPreview)+'٪';
  applyGlass();
});
dialog.addEventListener('change',async event=>{
  if (event.target.id!=='glass-range' || !isPaid()) return;
  const range = event.target;
  const {mode,palette} = profile.appearance;
  const request = ++glassRequest;
  try {
    const response = await socket.timeout(5000).emitWithAck('appearance',{mode,palette,transparency:range.valueAsNumber});
    if (response.error) throw new Error(response.error);
  } catch (error) {
    toast(error.message || 'تعذّر حفظ الشفافية.');
  } finally {
    if (request === glassRequest && glassPreview === range.valueAsNumber) {
      glassPreview = undefined;
      applyGlass();
      range.value = profile.appearance.transparency;
      const output = dialog.querySelector('#glass-value');
      if (output) output.value = num(profile.appearance.transparency)+'٪';
    }
  }
});

function applyAppearance() {
  applyGlass();
  const {mode,palette} = profile?.appearance || defaultAppearance;
  document.documentElement.dataset.mode = mode;
  document.documentElement.dataset.palette = palette;
  const specialty = profile?.equipped?.decoration;
  const theme = specialties[specialty];
  if (theme) {
    const [,symbol,first,second] = theme;
    document.documentElement.dataset.specialty = specialty;
    document.documentElement.style.setProperty('--specialty-first',first);
    document.documentElement.style.setProperty('--specialty-second',second);
    document.documentElement.style.setProperty('--specialty-symbol','url(/icons/'+symbol+'.svg)');
  } else delete document.documentElement.dataset.specialty;
  const custom = profile?.appearance?.custom;
  if (palette==='custom' && custom) {
    document.documentElement.style.setProperty('--custom-color',custom.first);
    document.documentElement.style.setProperty('--custom-fill',customFill(custom));
  }
  const control = document.querySelector('#appearance-toggle');
  const label = mode==='dark'?'الوضع النهاري':'الوضع الليلي';
  if (control.getAttribute('aria-label') !== label) {
    control.setAttribute('aria-label',label);
    control.title = label;
    control.innerHTML = icon(mode==='dark'?'sun':'moon');
    const background = mode==='dark' ? '#121417' : '#ffffff';
    document.querySelector('meta[name="theme-color"]').content = background;
    if (tg?.initData && tg.isVersionAtLeast?.('6.9')) {
      tg.setHeaderColor?.(background);
      tg.setBackgroundColor?.(background);
    }
  }
}

async function checkout(plan, control) {
  if (checkoutOpen || !profile?.prices?.[plan]) return;
  if (!tg?.openInvoice || !socket?.connected) return toast('افتح التطبيق داخل تليجرام لإتمام الاشتراك.');
  checkoutOpen = true;
  control.disabled = true;
  try {
    const {url,error} = await socket.timeout(10000).emitWithAck('membershipInvoice',{plan});
    if (!url) throw new Error(error || 'تعذّر إنشاء فاتورة العضوية.');
    tg.openInvoice(url,status=>{
      checkoutOpen = false;
      control.disabled = false;
      if (status==='paid' || status==='pending') {
        emit('refreshProfile');
        toast(status==='paid'?'تم الدفع. سيظهر تفعيل العضوية بعد تأكيد تليجرام.':'عملية الدفع قيد التأكيد.');
      } else if (status==='failed') toast('تعذّر إتمام الدفع.');
    });
  } catch (error) {
    checkoutOpen = false;
    control.disabled = false;
    toast(error.message || 'تعذّر فتح فاتورة تليجرام.');
  }
}
const serverNow = () => Date.now()+clockOffset;
function render(force=false) {
  account();
  applyAppearance();
  document.querySelectorAll('[data-tab]').forEach(b => {
    if (room?.phase==='active' && b.dataset.tab!=='home') b.setAttribute('aria-disabled','true');
    else b.removeAttribute('aria-disabled');
    if (b.dataset.tab===tab) b.setAttribute('aria-current','page'); else b.removeAttribute('aria-current');
  });
  const phase = !revisited && room?.phase;
  const key = [tab,phase,room?.id,isInvite()].join('|');
  if (force || key!==viewKey || ['active','lobby','outcome'].includes(phase)) {
    const content = blocked ? '<div class="inner">'+heading('الحساب محظور','تواصل مع مشرف ميثاق للمساعدة.')+'</div>' : tab==='admin'?adminPage():tab==='stats'?stats():tab==='store'?store():tab==='inventory'?inventoryPage():tab==='plans'?plansPage():tab==='themes'?themes():phase==='lobby'?lobby():phase==='active'?active():phase==='outcome'?outcome():home();
    if (page.dataset.content !== content) {
      const previous = document.activeElement;
      const selector = previous?.dataset.action && '[data-action="'+previous.dataset.action+'"][data-value="'+previous.dataset.value+'"]';
      page.innerHTML = content;
      page.dataset.content = content;
      if (key!==viewKey && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        page.animate([{opacity:.55,transform:'translateY(6px)'},{opacity:1,transform:'translateY(0)'}],
          {duration:240,easing:'ease-out'});
      }
      if (selector) page.querySelector(selector)?.focus({preventScroll:true});
    }
    viewKey = key;
  }
  if (tg?.initData && Boolean(phase==='active') !== tg.isClosingConfirmationEnabled) {
    if (phase==='active') tg.enableClosingConfirmation();
    else tg.disableClosingConfirmation();
  }
  updateClock();
}
function formatClock(seconds) {
  return [Math.floor(seconds/60),seconds%60].map(value=>String(value).padStart(2,'0')).join(':');
}
function updateClock() {
  const current=serverNow();
  document.querySelectorAll('[data-point-expiry]').forEach(element=>{const label=element.querySelector('b');if(label)label.textContent=remainingTime(Number(element.dataset.pointExpiry),current);});
  document.querySelectorAll('[data-membership-until]').forEach(element=>element.textContent=remainingTime(Number(element.dataset.membershipUntil),current));
  const rest = document.querySelector('#break-time');
  if (rest && room?.breakUntil) {
    const seconds = Math.max(0,Math.ceil((room.breakUntil-serverNow())/1000));
    rest.textContent = seconds>0 ? formatClock(seconds) : 'انتهت الاستراحة';
  }
  const digits = document.querySelector('#digits');
  if (!digits || tab!=='home' || room?.phase!=='active') return;
  const now = current;
  const counting = now < room.startsAt;
  const paused = now < room.pauseUntil;
  const remaining = Math.max(0,(counting?room.startsAt:paused?room.pauseUntil:room.endAt)-now);
  const value = Math.ceil(remaining/1000);
  digits.textContent = counting ? String(value) : formatClock(value);
  document.querySelector('#dial-label').textContent = counting?'تبدأ الجلسة خلال':paused?'وقت الاستراحة':'الوقت المتبقي';
  const focusRemaining = counting ? room.endAt-room.startsAt : room.endAt-(paused ? room.pauseUntil : now);
  digits.closest('.dial').style.setProperty('--progress',dialProgress(focusRemaining/60000));
  document.querySelectorAll('[data-exit]').forEach(e=>e.textContent=num(Math.max(0,Math.ceil((Number(e.dataset.exit)-now)/1000)))+' ث');
  const check = room.members.find(p=>p.id===user?.id)?.checkUntil;
  if (check > now && check!==lastCheck && appearanceOpen) dialog.close();
  if (check > now && check!==lastCheck && !dialog.open) {
    lastCheck = check;
    modal('هل ما زلت مركزًا؟','أكد حضورك خلال ٣٠ ثانية.',button('check','نعم، ما زلت مركزًا','primary','check'));
  }
  const deadline = dialog.querySelector('#check-deadline');
  if (deadline && check) deadline.textContent = num(Math.max(0,Math.ceil((check-now)/1000)))+' ثانية';
  if (deadline && (!check || check<=now)) dialog.close();
}
setInterval(updateClock,100);
function modal(title,text,buttons) {
  dialog.innerHTML = `<div class="stack"><h2>${title}</h2><p class="bodycopy">${text}</p>${buttons.includes('data-action="check"')?'<p id="check-deadline"></p>':''}<div class="actions">${buttons}</div></div>`;
  if (!dialog.open) dialog.showModal();
}
const vibe = () => {
  if (tg?.initData) tg.HapticFeedback?.impactOccurred('medium');
  else navigator.vibrate?.(120);
};
function sound(type, toggle=true) {
  if (audio) { audio.close(); audio = null; }
  if (toggle && ambience===type) { ambience=null; return render(true); }
  const Context = window.AudioContext || window.webkitAudioContext;
  if (!Context) return toast('الصوت غير مدعوم في هذا المتصفح.');
  audio = new Context();
  const buffer = audio.createBuffer(1,audio.sampleRate*4,audio.sampleRate);
  const samples = buffer.getChannelData(0);
  let previous=0;
  for (let i=0;i<samples.length;i++) {
    const raw = Math.random()*2-1;
    previous = (previous+.035*raw)/1.035;
    if (type==='white') samples[i]=raw*.20;
    else if (type==='rain') samples[i]=raw*.1+previous*2;
    else if (type==='fire') samples[i]=previous*2+(Math.random()<.003?raw*.4:0);
    else if (type==='forest') samples[i]=previous*(2.6+Math.sin(i/audio.sampleRate*3));
    else samples[i]=previous*2.7+Math.sin(i/audio.sampleRate*2*Math.PI*130)*.018;
  }
  const source = audio.createBufferSource();
  source.buffer = buffer;
  source.loop=true;
  source.connect(audio.destination);
  source.start();
  audio.resume().catch(()=>toast('تعذر تشغيل الصوت.'));
  ambience = type;
  render(true);
}
function stopSound() { if (audio) audio.close(); audio=null; ambience=null; }
function inviteUrl() {
  return roomInviteUrl({ bot, shortName, code:room.id, guestOrigin:tg?.initData ? null : location.origin });
}
function invitePanel() {
  if (room.members.length === 2) return '';
  const url = inviteUrl();
  return `<section class="panel stack invite-options"><h2>ادعُ شريكك</h2>
    <p class="bodycopy">${icon('gift')} عند إتمام صديقك أول جلسة له، تحصلان على ${num(referralPoints)} نقطة لكل واحد منكما.</p>
    <div class="invite-code"><label>رمز الغرفة<input id="invite-code" dir="ltr" value="${esc(room.code)}" readonly></label>
    ${button('copyCode','نسخ الرمز','secondary','hash')}</div>
    ${url?`<label class="field invite-field">رابط الدعوة<input id="invite-url" dir="ltr" value="${esc(url)}" readonly></label>
      <div class="actions">${button('copyInvite','نسخ الرابط','secondary','link-2')}
      ${tg?.initData?button('invite','مشاركة عبر تليجرام','primary','send'):''}</div>`:''}
    ${tg?.initData?`<form id="direct-invite-form" class="join-code"><label class="field">دعوة مباشرة<input name="handle" dir="ltr" placeholder="@username" maxlength="33" required></label><button class="secondary">${icon('user-round-plus')} ادعُه</button></form>`:''}
  </section>`;
}
async function copyInvite(selector, message) {
  const field = document.querySelector(selector);
  if (!field) return;
  try {
    await navigator.clipboard.writeText(field.value);
    toast(message);
  } catch {
    field.focus();
    field.select();
    field.setSelectionRange(0,field.value.length);
    toast('اضغط مطولًا على الحقل واختر «نسخ».');
  }
}
async function shareInvite(button) {
  if (preparingInvite) return;
  if (!tg?.isVersionAtLeast?.('8.0') || typeof tg.shareMessage !== 'function') {
    return toast('حدّث تطبيق تليجرام لإرسال دعوة بزر انضمام.');
  }
  if (!socket?.connected) return toast('الاتصال غير متاح حاليًا.');
  preparingInvite = true;
  button.disabled = true;
  try {
    const { messageId,error } = await socket.timeout(10000).emitWithAck('prepareInvite',{});
    if (!messageId) return toast(error || 'تعذّر تجهيز الدعوة.');
    tg.shareMessage(messageId,sent=>{ if (sent) toast('أُرسلت الدعوة.'); });
  } catch {
    toast('تعذّر فتح مشاركة الدعوة. جرّب مرة أخرى.');
  } finally {
    preparingInvite = false;
    button.disabled = false;
  }
}
async function shareCard() {
  await document.fonts.ready;
  const canvas = Object.assign(document.createElement('canvas'),{width:720,height:1280});
  const ctx = canvas.getContext('2d');
  ctx.fillStyle='#121417';ctx.fillRect(0,0,720,1280);
  ctx.strokeStyle='#58dfb0';ctx.lineWidth=3;ctx.strokeRect(52,52,616,1176);
  ctx.direction='rtl';ctx.textAlign='center';
  for (const [label,y,size,color] of [['ميثاق التركيز',245,44,'#58dfb0'],['أتممتُ ميثاق التركيز',520,49,'#f3f4f6'],[num(room.minutes)+' دقيقة تركيز ثنائي',635,39,'#f3f4f6'],['+'+num(profile?.history.find(result=>result.room===room.id)?.reward || successReward)+' نقطة من المنصة',735,33,'#58dfb0'],['LOCK-IN DUO',1080,28,'#a1a6b0']]) {
    ctx.fillStyle=color;ctx.font='700 '+size+'px Plex, Arial';ctx.fillText(label,360,y);
  }
  const file = new File([await new Promise(resolve=>canvas.toBlob(resolve))],'methaq-achievement.png',{type:'image/png'});
  if (navigator.canShare?.({files:[file]})) {
    try { await navigator.share({files:[file]}); return; } catch (error) { if (error.name==='AbortError') return; }
  }
  const url=URL.createObjectURL(file);
  Object.assign(document.createElement('a'),{href:url,download:file.name}).click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
document.addEventListener('click',event=>{
  if (blocked) return;
  const nav = event.target.closest('[data-tab]');
  if (nav) {
    if (room?.phase==='active' && nav.dataset.tab!=='home') return toast('التنقل متاح بعد انتهاء جلسة التركيز.');
    if (tab!==nav.dataset.tab) {
      tab=nav.dataset.tab;
      render();
      window.scrollTo({top:0,behavior:'instant'});
    }
    return;
  }
  const b = event.target.closest('[data-action]');
  if (!b) return;
  const {action,value}=b.dataset;
  if (action==='duration') {
    if (!durationAllowed(+value)) return premiumDuration(+value);
    chosen=+value; render(true);
  } else if (action==='appearanceMenu') openAppearance();
  else if (action==='mode') changeAppearance({mode:value});
  else if (action==='palette') {
    if (palettes[value]?.premium && !isPaid()) return toast('هذا اللون متاح مع برو وسبيشل.');
    changeAppearance({palette:value});
  }
  else if(action==='equip')toggleEquip(value);
  else if(action==='useInventory'){
    if(value==='shield'||value==='eraser')emit('protect',{item:value});
    else if(value==='pause')emit('requestPause');
    else if(['zap','coffee','horn'].includes(value))emit('signal',{item:value});
  }
  else if(action==='quantityMinus'||action==='quantityPlus'){
    const input=b.closest('.buy-form')?.querySelector('[name="quantity"]');if(input)input.value=Math.max(1,Number(input.value||1)+(action==='quantityPlus'?1:-1));
  }
  else if (action==='seePlans') {
    if (room?.phase==='active') return toast('الترقية متاحة بعد انتهاء جلسة التركيز.');
    if (dialog.open) dialog.close();
    tab='plans'; render();
    document.querySelector('#memberships')?.scrollIntoView({block:'start'});
  }
  else if(action==='seeMembership'){tab='plans';render();window.scrollTo({top:0,behavior:'instant'});}
  else if(action==='startTrial')emit('startTrial');
  else if (action==='openAdmin') {
    if (!profile?.admin || room?.phase==='active') return;
    if (dialog.open) dialog.close();
    tab='admin'; render(); window.scrollTo({top:0,behavior:'instant'});
    adminRequest('adminList',{search:adminSearch});
  }
  else if (action==='confirmAdminRevoke') modal('إزالة العضوية','سيعود الحساب إلى الباقة المجانية.',button('adminRevoke','إزالة العضوية','danger','user-round-minus',value)+button('close','رجوع','secondary'));
  else if (action==='adminRevoke') { dialog.close(); adminRequest('adminRevoke',{student:value}); }
  else if (action==='adminCopy') {
    navigator.clipboard?.writeText(value).then(()=>toast('نُسخ الكود.'),()=>toast('حدد الكود وانسخه يدويًا.'));
  }
  else if (action==='goHome') { tab='home'; render(); window.scrollTo({top:0,behavior:'instant'}); }
  else if (action==='activityDay') { activityDay=value; render(true); }
  else if (action==='copyReferralCode') copyInvite('#my-referral-code','نُسخ كود دعوتك.');
  else if (action==='copyReferralLink' || action==='shareReferral') shareReferral(action==='copyReferralLink');
  else if (action==='checkout') checkout(value,b);
  else if (action==='ignore') { inviteDismissed=true; render(true); }
  else if (action==='invite') shareInvite(b);
  else if (action==='copyInvite') copyInvite('#invite-url','نُسخ رابط الدعوة.');
  else if (action==='copyCode') {const field=document.querySelector('#invite-code');if(field)copyInvite('#invite-code','نُسخ رمز الغرفة.');else navigator.clipboard?.writeText(room?.code||'').then(()=>toast('نُسخ رمز الغرفة.'));}
  else if (action==='acceptInvite') {
    if (!incomingInvite || (room && room.phase!=='outcome')) return;
    invite=incomingInvite.code; incomingInvite=null; inviteDismissed=false;
    revisited=room?.phase==='outcome'; tab='home'; render(true);
    window.scrollTo({top:0,behavior:'instant'});
  } else if (action==='dismissInvite') { incomingInvite=null; render(true); }
  else if (action==='filter') { category=+value; render(true); }
  else if (action==='sound') sound(value);
  else if (action==='withdraw') modal('هل تريد الانسحاب؟','يُسجّل الانسحاب وتُخصم حتى ٢٠ نقطة من رصيدك.',button('confirmWithdraw','تأكيد الانسحاب','danger')+button('close','متابعة التركيز','secondary'));
  else if (action==='close') dialog.close();
  else if (action==='confirmWithdraw') { dialog.close(); emit('withdraw'); }
  else if (action==='check') { dialog.close(); emit('check'); }
  else if (action==='reset') { revisited=true; render(true); }
  else if (action==='shareCard') shareCard().catch(()=>toast('تعذرت مشاركة البطاقة.'));
  else if (action==='answerPause') emit(action,{accept:value==='yes'});
  else if (action==='result') emit(action,{done:value==='yes'});
  else emit(action,{item:value});
});
page.addEventListener('input',event=>{
  if (event.target.name==='goal') goal=event.target.value;
  if (event.target.name==='pact') pact=event.target.value;
  if (page.querySelector('#session-form')) page.dataset.content=home();
});
page.addEventListener('submit',event=>{
  const formElement = event.target;
  if (formElement.id==='claim-referral-form') {
    event.preventDefault();
    emit('claimReferral',{code:new FormData(formElement).get('code')});
    return;
  }
  if (formElement.classList.contains('buy-form')) {
    event.preventDefault();
    purchasePrompt(formElement.dataset.item,Number(new FormData(formElement).get('quantity') || 1));
    return;
  }
  if (formElement.id==='redeem-code-form') {
    event.preventDefault();
    emit('redeemCode',{code:new FormData(formElement).get('code')});
    return;
  }
  if (formElement.id==='admin-search-form' || formElement.id==='admin-code-form' || formElement.classList.contains('admin-student-form')) {
    event.preventDefault();
    const form = new FormData(formElement);
    if (formElement.id==='admin-search-form') {
      adminSearch=form.get('search');
      adminRequest('adminList',{search:adminSearch});
    } else if (formElement.id==='admin-code-form') adminRequest('adminCode',{plan:form.get('plan')});
    else {
      const student = formElement.dataset.student;
      const operation = event.submitter?.value;
      if (operation==='points') adminRequest('adminPoints',{student,points:Number(form.get('points')),validDays:Number(form.get('validDays'))});
      else if(operation==='removePoints') adminRequest('adminRemovePoints',{student,points:Number(form.get('points'))});
      else if (operation==='grant') adminRequest('adminGrant',{student,plan:form.get('plan')});
      else if (operation==='ban' || operation==='unban') adminRequest('adminBan',{student,banned:operation==='ban'});
    }
    return;
  }
  if (event.target.id==='direct-invite-form' || event.target.id==='join-code-form') {
    event.preventDefault();
    const form = new FormData(event.target);
    if (event.target.id==='direct-invite-form') emit('directInvite',{handle:form.get('handle')});
    else {
      const code=form.get('code').trim().toUpperCase();
      if (!/^[A-F0-9]{10}$/.test(code)) return toast('اكتب رمز الغرفة المكوّن من ١٠ خانات.');
      invite=code; inviteDismissed=false; render(true);
      window.scrollTo({top:0,behavior:'instant'});
    }
    return;
  }
  if (event.target.id!=='session-form') return;
  event.preventDefault();
  emit(isInvite()?'join':'create',isInvite()?{code:invite,goal}:{minutes:chosen,goal});
});
const presence = () => {
  if (socket?.connected && room?.phase==='active') socket.emit('presence',{hidden:document.hidden},()=>{});
};
document.addEventListener('visibilitychange',presence);
window.addEventListener('pagehide',()=>socket?.connected && room?.phase==='active' && socket.emit('presence',{hidden:true},()=>{}));
for (const event of ['pointerdown','keydown','scroll']) document.addEventListener(event,()=>{
  if (socket?.connected && room?.phase==='active' && Date.now()-lastActivity>3000) {
    lastActivity=Date.now();socket.emit('activity',{},()=>{});
  }
},{passive:true});
const telegramUser=tg?.initDataUnsafe?.user;
if(telegramUser){
  user={id:String(telegramUser.id),name:[telegramUser.first_name,telegramUser.last_name].filter(Boolean).join(' '),photo:telegramUser.photo_url,handle:telegramUser.username?.toLowerCase()};
  try{profile=JSON.parse(localStorage.getItem('methaq.profile.'+user.id)||'null');}catch{/* Ignore an invalid local snapshot. */}
}
render();
socket = window.io({auth:{initData:tg?.initData,guest:guestId,name}});
function showBan(message) {
  blocked=true;
  room=null;
  stopSound();
  if (dialog.open) dialog.close();
  toast(message);
  render(true);
}
socket.on('banned',showBan);
socket.on('connect_error',error=>{
  if (error.message==='حُظر هذا الحساب من استخدام ميثاق.') showBan(error.message);
  else toast(error.message);
});
socket.on('disconnect',()=>{ if (!blocked) toast('انقطع الاتصال. جارٍ إعادة المحاولة.'); });
function updateProfile(data) {
  const bonus = profile ? data.referralBonus - profile.referralBonus : 0;
  if (bonus>0) toast('وصلتك '+num(bonus)+' نقطة من دعوة صديق.');
  const optimistic=visualUpdatePending&&profile?{appearance:profile.appearance,equipped:profile.equipped}:null;
  if(optimistic)data={...data,...optimistic};
  const changed = profile?.appearance?.mode !== data.appearance?.mode || profile?.appearance?.palette !== data.appearance?.palette || profile?.plan?.tier !== data.plan?.tier || profile?.adminAccess !== data.adminAccess || JSON.stringify(profile?.appearance?.custom) !== JSON.stringify(data.appearance?.custom);
  profile = data;
  if(user?.id){
    const cached={points:data.points,pointGrants:data.pointGrants,pointExpiry:data.pointExpiry,streak:data.streak,inventory:data.inventory,equipped:data.equipped,plan:data.plan,cosmetics:data.cosmetics,appearance:data.appearance,reliability:data.reliability,completed:data.completed,minutes:data.minutes,left:data.left,now:data.now};
    try{localStorage.setItem('methaq.profile.'+user.id,JSON.stringify(cached));}catch{/* Storage can be unavailable in private mode. */}
  }
  clearTimeout(expiryTimer);
  const expires = [data.plan?.until,data.pointExpiry,...Object.values(data.cosmetics || {})].filter(value=>value>data.now);
  if (expires.length) expiryTimer = setTimeout(()=>emit('refreshProfile'),Math.min(2147483647,Math.min(...expires)-data.now+250));
  if(visualUpdatePending){account();applyAppearance();}
  else render(true);
  if(referralLaunch&&data.referrals?.code){const code=referralLaunch;referralLaunch=null;emit('claimReferral',{code});}
  if (changed && appearanceOpen && dialog.open) {
    const focus = dialog.querySelector(':focus');
    const focused = focus?.dataset;
    const showAdminAccess = dialog.querySelector('.admin-access')?.open;
    openAppearance();
    if (showAdminAccess) dialog.querySelector('.admin-access').open = true;
    if (focus?.id==='glass-range') dialog.querySelector('#glass-range')?.focus();
    if (focused?.action && focused?.value) dialog.querySelector('[data-action="'+focused.action+'"][data-value="'+focused.value+'"]')?.focus();
  }
}
socket.on('hello', data=>{
  ({user,bot,shortName}=data);
  updateProfile(data.profile);
  presence();
});
socket.on('profile',updateProfile);
socket.on('room', next=>{
  if (invite && !inviteDismissed && next?.phase==='outcome' && next.id!==invite) return;
  const previous=room;
  room=next;
  if (next) clockOffset=next.now-Date.now();
  if (previous?.id!==next?.id) { revisited=false; tab='home'; if (next) inviteDismissed=true; }
  if (previous?.phase!=='active' && next?.phase==='active') {
    tab='home';
    presence();
    if (profile?.equipped?.theme) sound(profile.equipped.theme,false);
  }
  if (previous?.phase==='active' && next?.phase!=='active') {
    stopSound();
    if (dialog.open) dialog.close();
    tab='home';
  }
  render();
  if (tab==='home' && (previous?.id!==next?.id || previous?.phase!==next?.phase)) {
    window.scrollTo({top:0,behavior:'instant'});
  }
});
socket.on('directInvite', data=>{
  incomingInvite=data;
  if (!room || room.phase==='outcome') {
    if (room?.phase==='outcome') revisited=true;
    tab='home'; render(true);
    window.scrollTo({top:0,behavior:'instant'});
  }
});
socket.on('signal',kind=>{
  vibe();
  if (kind!=='check') toast({nudge:'شريكك يذكّرك بالتركيز',zap:'صعقة تركيز من شريكك',coffee:'أهدى لك شريكك كوب قهوة ☕',horn:'🎉 شريكك يحتفل بإتمام الميثاق'}[kind] || '');
});
