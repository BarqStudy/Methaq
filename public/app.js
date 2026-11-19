import { items,sections,palettes,plans,rewards,successReward,storeArt,defaultAppearance,glassRange,durations,sessionTemplates } from './catalog.js';
import { readRoomInvite,roomInviteUrl } from './invite.js';

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
let invite = readRoomInvite({ startParam:tg?.initDataUnsafe?.start_param, hash:location.hash, search:location.search });
const icon = (name) => '<i aria-hidden="true" data-icon="'+name+'" style="--icon:url(/icons/'+name+'.svg)"></i>';
document.querySelectorAll('i[data-icon]').forEach(i => i.style.setProperty('--icon','url(/icons/'+i.dataset.icon+'.svg)'));
const esc = (v) => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num = (v) => Number(v || 0).toLocaleString('ar',{numberingSystem:'arab'});
let room, socket, user, profile, bot, shortName, clockOffset = 0, chosen = 25, tab = 'home', category = 0, goal = '', pact = '', inviteDismissed = false;
let viewKey, noticeTimeout, revisited, lastActivity = 0, lastCheck, audio, ambience;
let preparingInvite = false, incomingInvite;
let appearanceOpen = false, checkoutOpen = false, expiryTimer, glassPreview, glassRequest = 0;
const isPaid = () => ['pro','special'].includes(profile?.plan?.tier);
let adminData, adminSearch = '', adminBusy = false, blocked = false;
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
    else if (event==='appearance') toast('تم حفظ المظهر.');
    else if (event==='directInvite') toast('أُرسلت الدعوة داخل ميثاق.');
    else if (event==='redeemCode') toast('تم تفعيل عضويتك.');
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
  const accountElement = document.querySelector('#account');
  const content = `<span class="metric streak-stat"><span class="metric-icon">${icon('flame')}</span><span>السلسلة <strong>${num(p.streak)}</strong></span></span>
    <span class="metric points-stat"><span class="metric-icon">${icon('sparkles')}</span><span>النقاط <strong>${num(p.points)}</strong></span></span>`;
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
function studentProfile() {
  const equipped = profile?.equipped;
  const tier = profile?.plan?.tier;
  return `<section class="panel student-profile">
    ${avatar({...user,equipped})}<div><strong>${esc(user?.name || 'ضيف ميثاق')}</strong>
    <small>${items[equipped?.title]?.[1] || 'رفيق تركيز'}</small>
    ${tg?.initData && user?.id ? '<small>معرّف تليجرام <b dir="ltr">'+esc(user.id)+'</b></small>' : ''}</div>
    ${tier && tier!=='free' ? '<span class="tag">'+icon(plans[tier].icon)+' '+plans[tier].title+'</span>' : ''}</section>`;
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
    ${joining ? `<section class="intro"><h1>لديك دعوة للتركيز</h1><p>اكتب هدفك للانضمام إلى شريكك في غرفة التركيز.</p></section>` : `
    <section class="panel preview home-timer" aria-labelledby="focus-timer-title">
      <div class="preview-top"><h1 id="focus-timer-title">مؤقت التركيز</h1><span class="tag"><span class="dot"></span> جلسة ثنائية</span></div>
      ${dial(chosen+':00','مدة الجلسة',dialProgress(chosen))}
      <p class="preview-note">${icon('users')} يبدأ المؤقت بعد موافقة الطرفين</p>
    </section>
    <div class="durations" role="group" aria-label="مدة الجلسة">${durations.map(m=>`<button type="button" class="duration ${m===chosen?'on':''}" data-action="duration" data-value="${m}" aria-pressed="${m===chosen}"><strong>${num(m)}</strong> دقيقة${!durationAllowed(m)?icon('lock-keyhole'):''}</button>`).join('')}</div>`}
    <form class="panel form-main" id="session-form"><div class="panel-title"><span class="tile-icon">${icon('sliders-horizontal')}</span><div><h2>${joining?'انضم إلى الجلسة':'إعداد الجلسة'}</h2></div></div>
    <label class="field">هدف الجلسة<input required maxlength="160" name="goal" placeholder="ماذا ستنجز في هذه الجلسة؟" value="${esc(goal)}"></label>
    ${joining?'':`<label class="field">ميثاق تشجيعي <small class="optional">اختياري</small><input maxlength="160" name="pact" placeholder="مثال: نلخّص فصلًا بعد الجلسة" value="${esc(pact)}"></label>`}
    <button class="primary wide">${icon(joining?'log-in':'circle-plus')}${joining?'الانضمام إلى الغرفة':'أنشئ غرفة وادعُ شريكك'}</button>
    ${joining?button('ignore','العودة للرئيسية','plain'):''}</form>
    ${joining?'':`<form id="join-code-form" class="panel join-code"><label class="field">عندك رمز غرفة؟<input name="code" dir="ltr" maxlength="10" placeholder="رمز الغرفة" required></label><button class="secondary">${icon('log-in')} انضم بالرمز</button></form>
    <section class="panel template-panel"><div class="actions"><h2>قوالب التركيز</h2>${!isPaid()?'<span class="tag">'+icon('lock-keyhole')+' للمشتركين</span>':''}</div><div class="template-grid">${Object.entries(sessionTemplates).map(([key,t])=>button('template',t.label,'secondary',t.icon,key)).join('')}</div></section>`}
    <div class="pact-bar"><span class="tile-icon">${icon('shield-check')}</span><div><strong>ميثاق الجلسة</strong><p>عند إتمام الجلسة، تمنح المنصة كل طرف ${num(rewards.achievement)} نقطة إنجاز و${num(rewards.cooperation)} نقطة تعاون.</p></div><span class="tag">${icon('sparkles')} مكافأة المنصة</span></div></div>`;
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
  <section class="panel"><h2>ميثاق الجلسة</h2><p class="bodycopy">أتعهد بالبقاء حاضرًا والتركيز على هدفي. تمنحنا المنصة ${num(rewards.achievement)} نقطة إنجاز و${num(rewards.cooperation)} نقطة تعاون لكل منا عند الإتمام. عند الانسحاب تُحرق حتى ٢٠ نقطة من رصيد المنسحب، وتمنح المنصة شريكه ${num(rewards.steadfast)} نقطة صمود.</p>
  ${room.pact?'<p class="bodycopy">الميثاق التشجيعي: '+esc(room.pact)+'</p>':''}</section>
  ${me?.ready?'<p class="tag">وافقت على الميثاق. بانتظار شريكك.</p>':button('ready','أوافق وأنا مستعد','primary','lock-keyhole')}
  ${button('leaveLobby','مغادرة الغرفة','plain','log-out')}</div></div>`;
}
function active() {
  const partner = room.members.find(p=>p.id!==user?.id);
  const inventory = profile?.inventory || {};
  const request = room.pauseRequest?.until > serverNow() && room.pauseRequest;
  return `<div class="inner theme-${profile?.equipped?.theme || 'default'}">${heading('جلسة التركيز','ابقَ حاضرًا حتى نهاية المؤقت.')}<div class="stack">
  <section class="panel preview active-dial">${dial('00:00','الوقت المتبقي')}</section>${pair(true)}
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
  ${succeeded ? `<p class="bodycopy">${result.reward===successReward ? num(rewards.achievement)+' نقطة إنجاز + '+num(rewards.cooperation)+' نقطة تعاون · ' : ''}سلسلة الالتزام ${num(profile.streak)} يوم</p><h2>هل أنجزت هدفك؟</h2><div class="actions">${button('result','نعم',result.goal_done===1?'primary':'secondary','','yes')}${button('result','ليس بعد',result.goal_done===0?'primary':'secondary','','no')}</div>
  ${button('shareCard','مشاركة بطاقة الإنجاز','primary','share-2')}${profile.inventory.horn?button('signal','بوق الفوز','secondary','megaphone','horn'):''}` : ''}
  ${left && profile.inventory.shield && result.old_streak && !profile.streak ? button('protect','استخدام درع الحماية','secondary','shield','shield'):''}
  </section>${button('reset','جلسة جديدة','secondary','plus')}</div></div>`;
}
function stats() {
  const p = profile || {};
  return `<div class="inner">${heading('الإحصائيات','تابع تقدّمك في جلسات التركيز.') }
  <div class="stack"><div class="stat-grid">${[[p.completed,'جلسات مكتملة'],[p.minutes,'دقائق تركيز'],[p.streak,'أيام متتالية']].map(([n,l])=>`<div class="panel"><strong>${num(n)}</strong><p>${l}</p></div>`).join('')}</div>
  <section class="panel"><h2>سجل الجلسات</h2>${p.history?.length?p.history.map(r=>`<div class="list-row"><div><strong>${labels[r.status]}</strong><p class="muted">${esc(r.date.slice(0,10))} · ${num(r.minutes)} دقيقة</p></div><span class="${r.reward<0?'gold':'mint'}">${r.reward>0?'+':''}${num(r.reward)} نقطة</span></div>`).join(''):'<p class="bodycopy">سيظهر سجلّك بعد أول جلسة.</p>'}</section></div></div>`;
}
function memberships() {
  const active = profile?.plan?.tier;
  const until = profile?.plan?.until;
  return `<section class="membership-section stack" id="memberships" aria-labelledby="membership-title">
    <div><h2 id="membership-title">عضويات ميثاق</h2><p class="bodycopy">ألوان وتدرجات حصرية وتحكّم بشفافية الزجاج، كل الألقاب والثيمات، جلسات حتى ١٨٠ دقيقة وقوالب تركيز جاهزة واستراحة واحدة لكل جلسة بموافقة شريكك.</p>
    ${active==='pro' && until ? '<p class="bodycopy">برو مفعّل حتى '+new Date(until).toLocaleDateString('ar')+'</p>' : ''}</div>
    <div class="store-grid">${Object.entries(plans).map(([key,plan])=>{
      const price = profile?.prices?.[key];
      const status = active===key ? 'مفعّل' : active==='special' ? 'مشمول مع سبيشل' : '';
      const action = price && active!=='special' ? button('checkout',key==='pro' && status?'تمديد برو':'اختيار '+plan.title,'primary','star',key) : '';
      return `<article class="panel plan-card" style="--art:${plan.color}"><span class="art-plain">${icon(plan.icon)}</span>
        <h3>${plan.title}</h3><p>${plan.duration}</p>
        ${status?'<p class="mint">'+status+'</p>':''}
        ${active!=='special'?'<p class="gold">'+(price?num(price)+' نجمة تليجرام':'الشراء غير متاح حاليًا')+'</p>':''}
        ${action}${key==='pro'?'<small class="muted">دفعة واحدة لكل ٣٠ يومًا</small>':''}</article>`;
    }).join('')}</div></section>`;
}
function store() {
  const p = profile;
  return `<div class="inner store-page">${heading('متجر ميثاق','رصيدك الحالي '+num(p?.points)+' نقطة')}
  ${memberships()}
  <form id="redeem-code-form" class="panel join-code redeem-code">
    <label class="field">كود العضوية<input name="code" dir="ltr" maxlength="21" placeholder="MTHQ-…" required></label>
    <button class="secondary">${icon('ticket-check')} فعّل الكود</button>
  </form>
  <div class="filters">${sections.map((x,i)=>button('filter',x,i===category?'selected':'','',i)).join('')}</div>
  <div class="store-grid">${Object.entries(items).filter(([key,x])=>key!=='marathon' && x[0]===category).map(([key,[group,label,cost,symbol,desc]])=>{
    const count = p?.inventory[key] || 0;
    const expires = p?.cosmetics?.[key];
    const collectible = [1,2].includes(group);
    const available = collectible && (isPaid() || (group===2 ? expires : count));
    const equipped = Object.values(p?.equipped || {}).includes(key);
    const detail = collectible && isPaid() ? 'مشمول في العضوية' : group===2 && expires
      ? 'متاح حتى '+new Date(expires).toLocaleDateString('ar') : num(cost)+' نقطة'+(group===2?' · صالح ٣ أيام':count?' · في المخزون '+num(count):'');
    return `<article class="panel store-item">
      <div class="store-art art-${key}" style="--art:${storeArt[key]}"><span aria-hidden="true" class="art-orbit"></span>${icon(symbol)}${icon('sparkles')}</div>
      <h3>${label}</h3><p class="bodycopy">${desc}</p><span class="gold">${detail}</span>
      ${available?button('equip',equipped?'إلغاء التفعيل':'تفعيل',equipped?'primary':'secondary','',key):button('buy','شراء','secondary','',key)}
      ${key==='eraser'&&count?button('protect','استخدام','plain','',key):''}</article>`;
  }).join('')}</div></div>`;
}

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
        <p class="bodycopy">${esc(student.handle?'@'+student.handle+' · ':'')}${esc(student.id)} · ${status}</p></div>
        <form class="actions admin-student-form" data-student="${esc(student.id)}">
          ${!student.banned && student.plan.tier!=='special'?`<select name="plan" aria-label="الباقة"><option value="pro">برو</option><option value="special">سبيشل</option></select><button class="secondary" value="grant">${icon('circle-check')} فعّل</button>`:''}
          ${!student.admin?`<button class="${student.banned?'secondary':'danger'}" value="${student.banned?'unban':'ban'}">${student.banned?'رفع الحظر':'حظر'}</button>`:''}
        </form></article>`;
      }).join('') || '<p class="bodycopy">'+(adminData?'لم تظهر حسابات مطابقة.':'جارٍ تحميل الحسابات…')+'</p>'}</section>
    <section class="panel stack"><h2>أكواد العضوية</h2><p class="bodycopy">كل كود يفعّل العضوية لحساب واحد.</p>
      <form id="admin-code-form" class="actions"><label>الباقة <select name="plan"><option value="pro">برو</option><option value="special">سبيشل</option></select></label>
      <button class="primary">${icon('ticket-plus')} أنشئ كودًا</button></form>
      ${codes.map(entry=>`<div class="admin-row"><div><code dir="ltr">${esc(entry.code)}</code><p class="bodycopy">${plans[entry.plan]?.title} · ${entry.redeemed_by?'مستخدم':'متاح'}</p></div>
      ${!entry.redeemed_by?button('adminCopy','نسخ الكود','secondary','copy',entry.code):''}</div>`).join('')}</section></div></div>`;
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

function openAppearance() {
  if (dialog.open && !appearanceOpen) return;
  appearanceOpen = true;
  const appearance = profile?.appearance || defaultAppearance;
  dialog.innerHTML = `<div class="stack"><div class="appearance-head"><h2>مظهر المنصة</h2>${button('close','إغلاق','plain','x')}</div>
    <section class="appearance-card"><h3>وضع العرض</h3><div class="pair">${Object.entries({light:['نهاري','sun'],dark:['ليلي','moon']}).map(([mode,[label,symbol]])=>
      `<button type="button" class="mode-option ${mode}" data-action="mode" data-value="${mode}" aria-pressed="${mode===appearance.mode}">${icon(symbol)} ${label}</button>`).join('')}</div></section>
    <section class="appearance-card"><h3>الألوان</h3><div class="palette-grid">${Object.entries(palettes).map(([key,palette])=>{
      const locked = palette.premium && !isPaid();
      return `<button type="button" class="palette-option" data-action="palette" data-value="${key}" aria-pressed="${appearance.palette===key}">
        <span class="swatch" style="background:${palette.swatch}">${locked?icon('lock-keyhole'):''}</span>${palette.label}</button>`;
    }).join('')}</div>${!isPaid()?'<p class="bodycopy">الزمردي والأزرق متاحان للجميع. التدرجات والألوان الأخرى مع برو وسبيشل.</p>':''}</section>
    <section class="appearance-card glass-settings">
      <label for="glass-range">${icon(isPaid()?'droplets':'lock-keyhole')} شفافية الزجاج <output id="glass-value" for="glass-range">${num(appearance.transparency)}٪</output></label>
      <input id="glass-range" type="range" min="${glassRange.min}" max="${glassRange.max}" value="${appearance.transparency}" ${isPaid()?'':'disabled aria-describedby="glass-lock"'}>
      ${isPaid()?'':'<p class="bodycopy" id="glass-lock">تحكّم بالشفافية مع برو وسبيشل.</p>'}
    </section>
    ${!isPaid() && room?.phase!=='active' ? button('seePlans','عرض العضويات','secondary','crown') : ''}
    ${profile?.admin && room?.phase!=='active' ? button('openAdmin','لوحة الإدارة','secondary','shield') : ''}</div>`;
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
    const content = blocked ? '<div class="inner">'+heading('الحساب محظور','تواصل مع مشرف ميثاق للمساعدة.')+'</div>' : tab==='admin'?adminPage():tab==='stats'?stats():tab==='store'?store():phase==='lobby'?lobby():phase==='active'?active():phase==='outcome'?outcome():home();
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
function updateClock() {
  const digits = document.querySelector('#digits');
  if (!digits || tab!=='home' || room?.phase!=='active') return;
  const now = serverNow();
  const counting = now < room.startsAt;
  const paused = now < room.pauseUntil;
  const remaining = Math.max(0,(counting?room.startsAt:paused?room.pauseUntil:room.endAt)-now);
  const value = Math.ceil(remaining/1000);
  digits.textContent = counting ? String(value) : [Math.floor(value/60),value%60].map(n=>String(n).padStart(2,'0')).join(':');
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
  else if (action==='mode') emit('appearance',{mode:value,palette:profile?.appearance?.palette || 'emerald'});
  else if (action==='palette') {
    if (palettes[value]?.premium && !isPaid()) return toast('هذا اللون متاح مع برو وسبيشل.');
    emit('appearance',{mode:profile?.appearance?.mode || defaultAppearance.mode,palette:value});
  }
  else if (action==='seePlans') {
    if (room?.phase==='active') return toast('الترقية متاحة بعد انتهاء جلسة التركيز.');
    if (dialog.open) dialog.close();
    tab='store'; render();
    document.querySelector('#memberships')?.scrollIntoView({block:'start'});
  }
  else if (action==='openAdmin') {
    if (!profile?.admin || room?.phase==='active') return;
    if (dialog.open) dialog.close();
    tab='admin'; render(); window.scrollTo({top:0,behavior:'instant'});
    adminRequest('adminList',{search:adminSearch});
  }
  else if (action==='adminCopy') {
    navigator.clipboard?.writeText(value).then(()=>toast('نُسخ الكود.'),()=>toast('حدد الكود وانسخه يدويًا.'));
  }
  else if (action==='checkout') checkout(value,b);
  else if (action==='ignore') { inviteDismissed=true; render(true); }
  else if (action==='invite') shareInvite(b);
  else if (action==='copyInvite') copyInvite('#invite-url','نُسخ رابط الدعوة.');
  else if (action==='copyCode') copyInvite('#invite-code','نُسخ رمز الغرفة.');
  else if (action==='template') {
    if (!isPaid()) return toast('القوالب متاحة مع برو وسبيشل.');
    const template = sessionTemplates[value];
    if (!template) return;
    chosen = template.minutes;
    goal = template.goal;
    render(true);
    document.querySelector('[name="goal"]')?.focus();
  } else if (action==='acceptInvite') {
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
      if (operation==='grant') adminRequest('adminGrant',{student,plan:form.get('plan')});
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
  emit(isInvite()?'join':'create',isInvite()?{code:invite,goal}:{minutes:chosen,goal,pact});
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
  const changed = profile?.appearance?.mode !== data.appearance?.mode || profile?.appearance?.palette !== data.appearance?.palette || profile?.plan?.tier !== data.plan?.tier;
  profile = data;
  clearTimeout(expiryTimer);
  const expires = [data.plan?.until,...Object.values(data.cosmetics || {})].filter(value=>value>data.now);
  if (expires.length) expiryTimer = setTimeout(()=>emit('refreshProfile'),Math.min(2147483647,Math.min(...expires)-data.now+250));
  render(true);
  if (changed && appearanceOpen && dialog.open) {
    const focus = dialog.querySelector(':focus');
    const focused = focus?.dataset;
    openAppearance();
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
