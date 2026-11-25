import { items,sections,sectionGroups,palettes,plans,rewards,successReward,storeArt,defaultAppearance,glassRange,durations,referralPoints,specialties,specialOnly,premiumOnly } from './catalog.js';
import { readRoomInvite,readReferralInvite,telegramInviteUrl } from './invite.js';

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
tg?.disableClosingConfirmation?.();
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
const launch = {startParam:tg?.initDataUnsafe?.start_param,hash:location.hash,search:location.search};
let invite = readRoomInvite(launch);
let referralLaunch = readReferralInvite(launch);
const icon = (name) => '<i aria-hidden="true" data-icon="'+name+'" style="--icon:url(/icons/'+name+'.svg)"></i>';
document.querySelectorAll('i[data-icon]').forEach(i => i.style.setProperty('--icon','url(/icons/'+i.dataset.icon+'.svg)'));
const esc = (v) => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num = (v) => Number(v || 0).toLocaleString('en-US');
const remainingTime=(value,now=Date.now())=>{const minutes=Math.max(0,Math.ceil((value-now)/60000));const days=Math.floor(minutes/1440);const hours=Math.floor((minutes%1440)/60);const rest=minutes%60;return [days&&num(days)+' يوم',hours&&num(hours)+' ساعة',!days&&!hours&&num(rest)+' دقيقة'].filter(Boolean).join(' و ');};
let room, socket, user, profile, bot, shortName, clockOffset = 0, chosen = 5, tab = invite?'rooms':'dashboard', category = 0, goal = '', pact = '', inviteDismissed = false;
let viewKey, noticeTimeout, revisited;
let preparingInvite = false, incomingInvite;
let appearanceOpen = false, checkoutOpen = false, expiryTimer, glassPreview, glassRequest = 0;
const isPaid = () => ['pro','special'].includes(profile?.plan?.tier);
let purchaseBusy = false;
let activityDay;
let adminData, adminSearch = '', adminBusy = false, blocked = false;
let appointmentsData=null,appointmentsBusy=false;
let calendarCursor=null,calendarSelected=null;
let appearanceRequest = 0, appearanceSaveTimer, visualUpdatePending = false;
let tourIndex=-1,tourPositionTimer;
const guestId = sessionStorage.getItem('methaq-guest') || Array.from(crypto.getRandomValues(new Uint8Array(18)), b=>b.toString(16).padStart(2,'0')).join('');
sessionStorage.setItem('methaq-guest',guestId);
const name = new URLSearchParams(location.search).get('name') || 'ضيف ميثاق';

function toast(message) {
  clearTimeout(noticeTimeout);
  notice.innerHTML=`<button type="button" class="notice-close" aria-label="إغلاق التنبيه">×</button><span class="notice-icon">${icon('circle-check')}</span><span class="notice-message"></span><span class="notice-progress" aria-hidden="true"></span>`;
  notice.querySelector('.notice-message').textContent=message;
  notice.classList.remove('is-held');
  noticeRemaining=3000;
  armNotice();
}
let noticeRemaining=3000,noticeStarted=0;
function clearNotice(){clearTimeout(noticeTimeout);notice.innerHTML='';notice.classList.remove('is-held');}
function armNotice(){noticeStarted=performance.now();notice.style.setProperty('--notice-duration',noticeRemaining+'ms');noticeTimeout=setTimeout(clearNotice,noticeRemaining);}
notice.addEventListener('pointerdown',event=>{
  if(!notice.textContent||event.target.closest('.notice-close'))return;
  noticeRemaining=Math.max(0,noticeRemaining-(performance.now()-noticeStarted));
  clearTimeout(noticeTimeout);notice.classList.add('is-held');notice.setPointerCapture?.(event.pointerId);
});
const resumeNotice=()=>{if(!notice.classList.contains('is-held')||!notice.textContent)return;notice.classList.remove('is-held');armNotice();};
notice.addEventListener('pointerup',resumeNotice);notice.addEventListener('pointercancel',resumeNotice);
notice.addEventListener('click',event=>{if(event.target.closest('.notice-close'))clearNotice();});
const tourSteps=[
  {selector:'.student-profile',title:'حسابك في ميثاق',text:'هنا تظهر هويتك، لقبك، وشارة عضويتك النشطة.'},
  {selector:'.home-timer',title:'حدّد وقت التركيز',text:'حرّك مقبض الدائرة مع عقارب الساعة، أو اختر مدة سريعة أسفلها.'},
  {selector:'#create-session-form',title:'أنشئ غرفة تركيز',text:'الهدف اختياري. أنشئ الغرفة ثم أرسل رمزها أو دعوتها لشريكك.'},
  {selector:'[data-tab="rooms"]',title:'انضم إلى شريكك',text:'استخدم صفحة الغرف لإدخال الرمز أو قبول دعوة مباشرة.'},
  {selector:'[data-tab="appointments"]',title:'مواعيدك أمامك',text:'أضف الاختبارات والتسليمات ورتبها حسب موعدها.'}
];
const tourStorageKey=()=>`methaq.tour.v1.${user?.id||guestId}`;
function positionTour(){
  const layer=document.querySelector('.tour-layer');
  const target=document.querySelector(tourSteps[tourIndex]?.selector);
  if(!layer||!target)return;
  const rect=target.getBoundingClientRect();
  const highlight=layer.querySelector('.tour-highlight');
  Object.assign(highlight.style,{left:Math.max(6,rect.left-6)+'px',top:Math.max(6,rect.top-6)+'px',width:Math.min(innerWidth-12,rect.width+12)+'px',height:Math.min(innerHeight-12,rect.height+12)+'px'});
  const card=layer.querySelector('.tour-card');
  const width=Math.min(350,innerWidth-28);
  card.style.width=width+'px';
  card.style.left=Math.max(14,Math.min(innerWidth-width-14,rect.left+rect.width/2-width/2))+'px';
  const height=card.offsetHeight;
  const below=innerHeight-rect.bottom;
  card.style.top=(below>=height+24?Math.min(innerHeight-height-14,rect.bottom+16):Math.max(14,rect.top-height-16))+'px';
  card.classList.toggle('points-up',below>=height+24);
}
function showTourStep(){
  const step=tourSteps[tourIndex];
  const target=document.querySelector(step?.selector);
  if(!step||!target)return endTour(true);
  let layer=document.querySelector('.tour-layer');
  if(!layer){layer=document.createElement('div');layer.className='tour-layer';document.body.append(layer);}
  const last=tourIndex===tourSteps.length-1;
  layer.innerHTML=`<div class="tour-highlight"></div><section class="tour-card" role="dialog" aria-modal="true" aria-labelledby="tour-title"><button type="button" class="tour-close" data-action="tourSkip" aria-label="تخطي الجولة">×</button><small>${num(tourIndex+1)} من ${num(tourSteps.length)}</small><h2 id="tour-title">${step.title}</h2><p>${step.text}</p><div class="tour-progress">${tourSteps.map((_,index)=>`<i class="${index<=tourIndex?'done':''}"></i>`).join('')}</div><div class="tour-actions">${tourIndex?'<button type="button" class="plain" data-action="tourPrevious">السابق</button>':'<button type="button" class="plain" data-action="tourSkip">تخطي الجولة</button>'}<button type="button" class="primary" data-action="tourNext">${last?'ابدأ الآن':'التالي'}</button></div></section>`;
  target.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'center',inline:'center'});
  clearTimeout(tourPositionTimer);tourPositionTimer=setTimeout(positionTour,260);
}
function startTour(){
  if(room?.phase==='active')return toast('الجولة متاحة بعد انتهاء جلسة التركيز.');
  if(dialog.open)dialog.close();
  tab='home';render(true);tourIndex=0;
  requestAnimationFrame(showTourStep);
}
function endTour(save=true){
  document.querySelector('.tour-layer')?.remove();tourIndex=-1;clearTimeout(tourPositionTimer);
  if(save){
    if(profile)profile.tourSeen=true;
    try{localStorage.setItem(tourStorageKey(),'done');}catch{/* Private mode. */}
    if(socket?.connected)socket.emit('completeTour',{},()=>{});
  }
}
function maybeStartTour(){
  let completed=Boolean(profile?.tourSeen);try{completed ||= localStorage.getItem(tourStorageKey())==='done';}catch{/* Private mode. */}
  const mobile=matchMedia('(max-width:720px)').matches;
  if(mobile&&!completed&&!room&&!blocked)setTimeout(()=>!room&&tourIndex<0&&startTour(),700);
}
addEventListener('resize',()=>tourIndex>=0&&positionTour());
addEventListener('scroll',()=>tourIndex>=0&&requestAnimationFrame(positionTour),{passive:true});
function emit(event,payload={}) {
  if (!socket?.connected) return;
  socket.timeout(12000).emit(event,payload,(error,response) => {
    if (response?.error) toast(response.error);
    else if (error) return;
    else if (['buy','equip','protect'].includes(event)) toast('تم تحديث مخزونك.');
    else if (event==='customPalette') toast('تم حفظ ألوانك.');
    else if (event==='appearance') toast('تم حفظ المظهر.');
    else if (event==='directInvite') toast('أُرسلت الدعوة داخل ميثاق.');
    else if (event==='redeemCode') toast('تم تفعيل عضويتك.');
    else if (event==='startTrial') toast('بدأت تجربة برو المجانية لمدة 3 أيام.');
    else if (event==='resetAppearance') toast('عاد المظهر إلى الإعداد الافتراضي.');
    else if (event==='claimReferral') toast('تمت إضافة 100 نقطة لك ولصديقك.');
  });
}
function avatar(person) {
  const classes = 'avatar'+(person?.equipped?.frame ? ' gold-frame':'')+(person?.tier==='pro'?' plan-ring-pro':person?.tier==='special'?' plan-ring-special':'');
  const photo = person?.photo;
  return photo && /^https:\/\//i.test(photo)
    ? '<img class="'+classes+'" src="'+esc(photo)+'" alt="" referrerpolicy="no-referrer">'
    : '<span class="'+classes+'" aria-hidden="true">'+(esc(person?.name?.[0]) || icon('user-round'))+'</span>';
}
function account() {
  const accountElement = document.querySelector('#account');
  const content = '';
  accountElement.hidden=true;
  if (accountElement.dataset.content !== content) {
    accountElement.innerHTML = content;
    accountElement.dataset.content = content;
  }
}
const button = (action,label,type='secondary',symbol='',value='') => `<button type="button" class="${type}" data-action="${action}" data-value="${value}">${symbol ? icon(symbol):''}${label}</button>`;
const heading = (title,caption='') => `<div class="heading">${tab!=='home'?button('backPage','رجوع','page-back','arrow-right'):''}<div class="heading-copy"><h1>${title}</h1>${caption?'<p>'+caption+'</p>':''}</div></div>`;
const isInvite = () => invite && !inviteDismissed && (!room || revisited);
const durationAllowed = (minutes) => minutes<120 || isPaid();
const breakDuration=minutes=>minutes<=25?5:minutes<=50?10:minutes<=90?12:minutes<=120?15:20;
const dialProgress = (minutes) => minutes<=25 ? Math.max(0,minutes) : Math.min(100,25+(minutes-25)*75/155);
// The selectable 5–180 minute range is one clockwise revolution.
const durationDialProgress = (minutes) => Math.max(0,Math.min(100,(Number(minutes)-5)*100/175));
function decorationStyle() {
  const key = profile?.equipped?.decoration;
  return key ? 'data-decoration="'+key+'" style="--decoration:'+storeArt[key]+'"' : '';
}
function decorationIcon() {
  const key = profile?.equipped?.decoration;
  return key ? '<span class="decoration-art" aria-hidden="true">'+icon(items[key][3])+'</span>' : '';
}
function membershipMark(tier){
  if(tier==='pro')return `<span class="member-mark pro-mark" title="عضو برو موثّق" aria-label="عضو برو موثّق"><svg viewBox="0 0 36 36" aria-hidden="true"><path class="badge-shell" d="M18 1.8l4 3.1 5-.2 1.5 4.7 4.2 2.8-1.7 4.7 1.7 4.7-4.2 2.8-1.5 4.7-5-.2-4 3.1-4-3.1-5 .2-1.5-4.7-4.2-2.8L5 16.9 3.3 12.2l4.2-2.8L9 4.7l5 .2z"/><path class="badge-core" d="M18 6.3l8.3 4.8v9.7L18 25.7l-8.3-4.9v-9.7z"/><path class="member-stroke" d="M12.7 17.2l3.3 3.1 7-7.2"/></svg></span>`;
  if(tier==='special')return `<span class="member-mark special-mark" title="عضو سبيشل حصري" aria-label="عضو سبيشل حصري"><svg viewBox="0 0 36 36" aria-hidden="true"><path class="badge-shell" d="M18 1.5l4.1 5.1 6.4.9.9 6.4 5.1 4.1-5.1 4.1-.9 6.4-6.4.9-4.1 5.1-4.1-5.1-6.4-.9-.9-6.4L1.5 18l5.1-4.1.9-6.4 6.4-.9z"/><path class="badge-core" d="M9.3 14.2L18 7.9l8.7 6.3L18 28.1z"/><path class="badge-facet" d="M9.3 14.2h17.4M13.8 14.2L18 28.1l4.2-13.9M13.8 14.2L18 7.9l4.2 6.3"/></svg></span>`;
  return '';
}
function studentProfile() {
  const equipped = profile?.equipped;
  const tier=profile?.plan?.tier;
  const badge=membershipMark(tier);
  return `<section class="panel student-profile" ${decorationStyle()}>
    ${decorationIcon()}
    ${avatar({...user,equipped,tier})}<div class="student-copy"><strong class="student-name">${esc(user?.name || 'ضيف ميثاق')} ${badge}</strong>
    <small>${items[equipped?.title]?.[1] || 'رفيق تركيز'}</small>
    </div></section>`;
}
function pendingInvite() {
  if (!incomingInvite || isInvite()) return '';
  return `<section class="panel direct-banner"><p><strong>${esc(incomingInvite.name)}</strong> يدعوك لجلسة ${num(incomingInvite.minutes)} دقيقة.</p>
    <div class="actions">${button('acceptInvite','انضمام','primary','user-round-plus')}${button('dismissInvite','تجاهل','plain')}</div></section>`;
}
function showIncomingInvite(data){
  incomingInvite=data;
  if(dialog.open)dialog.close();
  appearanceOpen=false;
  dialog.innerHTML=`<section class="direct-invite-dialog"><button type="button" class="tour-close" data-action="dismissInvite" aria-label="إغلاق">×</button><div class="invite-avatar">${icon('user-round-plus')}</div><small>دعوة تركيز مباشرة</small><h2>${esc(data.name)} يدعوك</h2><p>جلسة ثنائية لمدة <strong>${num(data.minutes)} دقيقة</strong>. يمكنك الانضمام إلى غرفة الاستعداد الآن.</p><div class="direct-invite-actions"><button type="button" class="primary" data-action="acceptInvite">${icon('log-in')} انضم الآن</button><button type="button" class="plain" data-action="dismissInvite">ليس الآن</button></div></section>`;
  dialog.showModal();
  vibe();
}
const dialHandlePosition=progress=>{const angle=progress*3.6*Math.PI/180;return `left:${50+48*Math.sin(angle)}%;top:${50-48*Math.cos(angle)}%`;};
function dial(text,label,progress=0,interactive=false) {
  return `<div class="orbit"><div class="dial ${interactive?'interactive-dial':''}" style="--progress:${progress}" ${interactive?'role="slider" aria-label="مدة الجلسة" aria-valuemin="5" aria-valuemax="180" aria-valuenow="'+chosen+'" tabindex="0"':''}>${interactive?`<span class="dial-handle" style="${dialHandlePosition(progress)}" aria-hidden="true"></span>`:''}<div class="dial-content">${icon('lock-keyhole')}<strong class="digits" id="digits">${text}</strong>${label?`<small id="dial-label">${label}</small>`:''}</div></div>
  <span class="satellite one">${icon('user-round')}</span><span class="satellite two">${icon('user-round')}</span></div>`;
}
function studyTabs() {
  return `<nav class="study-tabs" aria-label="المذاكرة">
    <button type="button" data-tab="home" aria-current="${tab==='home'?'page':'false'}">${icon('timer')} مؤقت المذاكرة</button>
    <button type="button" data-tab="rooms" aria-current="${tab==='rooms'?'page':'false'}">${icon('door-open')} انضم لغرفة</button>
  </nav>`;
}
function dashboard() {
  const service = (target, symbol, label, description) => `<button type="button" class="service-tile" ${target==='absenceCalculator'?'data-action':'data-tab'}="${target}">
    <span class="service-icon">${icon(symbol)}</span>
    <span class="service-copy"><strong>${label}</strong><small>${description}</small></span>
    ${icon('chevron-left')}
  </button>`;
  return `<div class="inner focus-home student-dashboard">
    ${studentProfile()}
    <section class="panel stack university-services">
      <h2>خدمات طلاب جامعة نجران</h2>
      ${service('home','timer','المذاكرة','ابدأ جلسة أو انضم لشريك')}
      ${service('university','calendar-days','تقويم الجامعة','الاختبارات والحذف والإضافة')}
      ${service('appointments','calendar-clock','أحداثي','أضف موعدًا وتابع الوقت المتبقي')}
      ${service('absenceCalculator','calculator','احسب غيابي','اعرف نسبة غيابك والمتبقي')}
    </section>
  </div>`;
}
function home() {
  return `<div class="inner focus-home">
    ${studyTabs()}
    ${studentProfile()}
    <section class="panel preview home-timer" ${decorationStyle()} aria-labelledby="focus-timer-title">
      <div class="preview-top"><span class="tag"><span class="dot"></span> جلسة ثنائية</span></div>
      ${decorationIcon()}
      ${dial(chosen+':00','',durationDialProgress(chosen),true)}
      <p class="preview-note">${icon('users')} يبدأ المؤقت بعد موافقة الطرفين</p>
    </section>
    <section class="duration-picker" aria-label="اختيار سريع للمدة"><div class="duration-picker-head"><span>${icon('clock-3')} اختيار سريع</span><small>بالدقائق</small></div><div class="durations" role="group" aria-label="مدة الجلسة">${durations.map(m=>`<button type="button" class="duration ${m===chosen?'on':''}" data-action="duration" data-value="${m}" aria-pressed="${m===chosen}"><strong>${num(m)}</strong><span>دقيقة</span>${!durationAllowed(m)?icon('lock-keyhole'):''}</button>`).join('')}</div></section>
    <form class="panel form-main create-room-form" id="create-session-form"><button class="create-room-heading" aria-label="إنشاء غرفة جديدة"><span class="tile-icon">${icon('plus')}</span><span><strong>إنشاء غرفة</strong><small>اضغط هنا بعد اختيار المدة</small></span></button>
    <label class="field">هدف الجلسة <small class="optional">اختياري</small><input maxlength="160" name="goal" placeholder="ماذا ستنجز في هذه الجلسة؟" value="${esc(goal)}"></label></form></div>`;
}
function roomsPage(){
  const joining=isInvite();
  return `<div class="inner rooms-page">${studyTabs()}${pendingInvite()}
    ${joining?`<section class="panel join-invite-card"><span class="tile-icon">${icon('user-round-plus')}</span><h2>دعوة جاهزة للانضمام</h2><p class="bodycopy">اكتب هدفًا مختصرًا إن رغبت، ثم ادخل غرفة الاستعداد مباشرة.</p><form id="join-session-form"><label class="field">هدف الجلسة <small class="optional">اختياري</small><input maxlength="160" name="goal" placeholder="ماذا ستنجز؟" value="${esc(goal)}"></label><button class="primary wide">${icon('log-in')} الانضمام إلى الغرفة</button></form>${button('ignore','إلغاء الدعوة','plain','x')}</section>`:`<form id="join-code-form" class="panel room-code-join"><span class="room-join-icon">${icon('door-open')}</span><div><h2>انضم برمز الغرفة</h2><p class="bodycopy">اطلب الرمز المكوّن من 8 حروف وأرقام من شريكك.</p></div><label class="field"><input name="code" dir="ltr" maxlength="8" autocapitalize="characters" pattern="[A-Fa-f0-9]{8}" placeholder="رمز الغرفة" required></label><button class="primary wide">${icon('log-in')} دخول غرفة الاستعداد</button></form>`}
  </div>`;
}
function person(p, active=false) {
  if (!p) return `<button type="button" class="panel person waiting-person" data-action="invite">${avatar()}<div><h3>شريك التركيز</h3><p>اضغط لإرسال رابط الدعوة</p><span class="tag">${icon('send')} دعوة عبر تليجرام</span></div></button>`;
  const status = active ? '<span class="dot pulse"></span> يركز الآن'
    : p.ready ? 'وافق على الميثاق' : 'بانتظار الموافقة';
  return `<article class="panel person">${avatar(p)}<div><h3 class="student-name">${esc(p.name)} ${membershipMark(p.tier)} ${p.id===user?.id?' <small class="muted">(أنت)</small>':''}</h3>
  ${p.equipped?.title?'<small class="gold">'+items[p.equipped.title][1]+'</small>':''}<p>${esc(p.goal)}</p><span class="tag">${status}</span></div></article>`;
}
const pair = (active) => '<div class="pair">'+person(room.members.find(p=>p.id===user?.id),active)+person(room.members.find(p=>p.id!==user?.id),active)+'</div>';
function lobby() {
  const me = room.members.find(p=>p.id===user?.id);
  return `<div class="inner">${heading('غرفة الانتظار','جلسة تركيز لمدة '+num(room.minutes)+' دقيقة')}<div class="stack">${pair(false)}
  ${invitePanel()}
  <section class="panel"><h2>ميثاق الجلسة</h2><p class="bodycopy">أتعهد بالبقاء حاضرًا والتركيز على هدفي. تمنح المنصة كل طرف ${num(rewards.achievement)} نقطة إنجاز عند الإتمام. عند الانسحاب تُحرق حتى 20 نقطة من رصيد المنسحب، وتمنح المنصة شريكه ${num(rewards.steadfast)} نقطة صمود.</p></section>
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
  ${request ? '<section class="panel actions">'+(request.id===user.id?'بانتظار موافقة شريكك على الاستراحة.':'شريكك يطلب استراحة لمدة 3 دقائق. '+button('answerPause','أوافق','primary','','yes')+button('answerPause','متابعة الجلسة','secondary','','no'))+'</section>':''}
  <section class="panel focus-tools stack">
    ${(inventory.zap||inventory.coffee||inventory.pause||(isPaid()&&!room.premiumPauseUsed))?`<div class="tool-section gift-section"><div class="tool-heading">${icon('gift')}<div><h3>تفاعل مع شريكك</h3><p>لفتة صغيرة تصل إليه فورًا</p></div></div><div class="gift-grid">${inventory.zap?button('signal','صعقة التركيز','secondary gift-action','zap','zap'):''}${inventory.coffee?button('signal','إهداء قهوة','secondary gift-action','coffee','coffee'):''}${inventory.pause||(isPaid()&&!room.premiumPauseUsed)?button('requestPause','استراحة محارب','secondary gift-action','timer-reset'):''}</div></div>`:''}
    <div class="withdraw-section"><div><strong>إنهاء الجلسة</strong><small>سيُسجّل الانسحاب في حسابك</small></div>${button('withdraw','انسحاب','danger withdraw-action','log-out')}</div>
  </section></div></div>`;
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
  ${profile.inventory.horn?button('signal','بوق الفوز','secondary','megaphone','horn'):''}` : ''}
  ${left && profile.inventory.shield && result.old_streak && !profile.streak ? button('protect','استخدام درع الحماية','secondary','shield','shield'):''}
  </section>
  ${succeeded && room.breakUntil ? `<section class="panel break-card">
    <span class="tile-icon">${icon('timer-reset')}</span><div><h2>استراحة بعد التركيز</h2><p class="bodycopy">${num(breakDuration(room.minutes))} دقيقة قبل جلستك التالية</p></div>
    <strong class="break-time" id="break-time" dir="ltr"></strong></section>`:''}
  <div class="actions outcome-actions">${succeeded&&!room.breakUntil?button('outcomeBreak','أخذ استراحة','secondary','timer-reset'):''}${button('goHome','إنهاء والخروج','primary','log-out')}</div></div></div>`;
}
const weekDay = new Intl.DateTimeFormat('ar-SA-u-nu-latn',{weekday:'short',timeZone:'UTC'});
const sessionDate = new Intl.DateTimeFormat('ar-SA-u-nu-latn',{day:'numeric',month:'short',calendar:'gregory',timeZone:'UTC'});
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
    <div class="stats-section-head"><span class="stats-icon">${icon('chart-no-axes-column')}</span><div><h2>نشاط التركيز</h2><p>آخر 7 أيام</p></div></div>
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
    <div class="stats-section-head"><span class="stats-icon">${icon('gift')}</span><div><h2>دعوة الأصدقاء</h2><p>${num(referralPoints)} نقطة لك ولصديقك فور تفعيل الكود · بحد أقصى 3 أصدقاء يوميًا.</p></div></div>
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
  const features={
    pro:['جلسات حتى 180 دقيقة','كل ثيمات التخصصات','ألوان وتدرجات مخصصة','التحكم بشفافية الزجاج','استراحة محارب في كل جلسة','شارة برو وإطار حساب مميز'],
    special:['كل مزايا برو مدى الحياة','لا تجديد ولا رسوم شهرية','ثيم سبيشل الأبدي الحصري','شارة سبيشل وإطار حساب حصري','كل الثيمات الحالية والمستقبلية','ألوان وتدرجات غير محدودة','أولوية المزايا الجديدة مستقبلًا']
  };
  return `<section class="membership-section stack" id="memberships" aria-labelledby="membership-title">
    <div><h2 id="membership-title">عضويات ميثاق</h2><p class="bodycopy">اختر العضوية المناسبة لك، أو جرّب برو مجانًا لمدة 3 أيام مرة واحدة.</p></div>
    ${active==='pro' && until ? `<div class="membership-countdown"><span>${profile.plan.trial?'تجربة برو':'برو'} مفعّل حتى ${new Date(until).toLocaleDateString('ar-SA-u-nu-latn')}</span><strong data-membership-until="${until}">${remainingTime(until,serverNow())}</strong></div>` : ''}
    <div class="store-grid">${Object.entries(plans).map(([key,plan])=>{
      const price = profile?.prices?.[key];
      const status = active===key ? 'مفعّل' : active==='special' ? 'مشمول مع سبيشل' : '';
      const action = price && active!=='special' && !(key==='pro'&&active==='pro') ? button('checkout','اختيار '+plan.title,'primary','star',key) : '';
      return `<article class="panel plan-card" style="--art:${plan.color}"><span class="art-plain">${icon(plan.icon)}</span>
        <h3>${plan.title}</h3><p>${plan.duration}</p><ul class="plan-features">${features[key].map(feature=>`<li>${icon('circle-check')} ${feature}</li>`).join('')}</ul>
        ${status?'<p class="mint">'+status+'</p>':''}
        ${active!=='special'?'<p class="gold">'+(price?num(price)+' نجمة تليجرام':'الشراء غير متاح حاليًا')+'</p>':''}
        ${action}${key==='pro'?'<small class="muted">دفعة واحدة لكل 30 يومًا</small>':''}</article>`;
    }).join('')}</div>
    ${active==='free'&&profile?.plan?.trialAvailable?button('startTrial','ابدأ تجربة برو المجانية · 3 أيام','secondary','timer'):''}</section>`;
}
function redeemCodeCard(){return `<form id="redeem-code-form" class="panel join-code redeem-code">
    <label class="field"><strong>عندك كود؟ فعّله الآن</strong><small class="code-hint">افتح مزايا عضويتك فورًا</small><input name="code" dir="ltr" maxlength="21" placeholder="MTHQ-…" required></label>
    <button class="secondary">${icon('ticket-check')} فعّل الكود</button>
  </form>`;}
function plansPage(){return `<div class="inner store-page">${heading('الاشتراكات','مزايا أكثر لجلسات تركيز أهدأ وأطول.')}${redeemCodeCard()}${memberships()}</div>`;}
function pointsWallet(){
  const total=Number(profile?.points||0);
  const temporary=(profile?.pointGrants||[]).reduce((sum,grant)=>sum+Number(grant.amount||0),0);
  return `<section class="panel points-wallet"><div class="wallet-main"><span class="wallet-icon">${icon('sparkles')}</span><div><small>رصيدك الحالي</small><strong>${num(total)}</strong><span>نقطة</span></div></div><div class="wallet-details"><div><small>رصيد دائم</small><strong>${num(Math.max(0,total-temporary))}</strong></div>${temporary?`<div class="temporary-balance" data-point-expiry="${profile.pointExpiry}"><small>نقاط مؤقتة</small><strong>+${num(temporary)}</strong><span>تنتهي خلال <b>${remainingTime(profile.pointExpiry,serverNow())}</b></span></div>`:`<div><small>النقاط المؤقتة</small><strong>—</strong><span>لا يوجد رصيد منتهٍ</span></div>`}</div></section>`;
}
function storeSectionIntro(group){
  const info={
    0:['shield','الحماية والوقت','أدوات عملية تُستخدم عند الحاجة: تحمي سلسلتك، تعالج انسحابًا سابقًا، أو تمنحك استراحة داخل الجلسة. كل استخدام يستهلك قطعة من مخزونك.','منتجات قابلة للاستهلاك'],
    2:['badge-check','الألقاب والشارات','تظهر بجانب اسمك وتمنح حسابك هوية مميزة. المشتريات العادية صالحة 3 أيام، والمشتركون يستخدمون العناصر المشمولة طوال مدة العضوية.','يُفعّل لقب أو إطار واحد'],
    3:['gift','التفاعلات','هدايا وإشارات ترسلها لشريكك أثناء جلسة التركيز. كل إرسال يستهلك قطعة واحدة، ويمكن شراء أكثر من قطعة مسبقًا.','تُستخدم داخل الجلسة'],
    4:['palette','الثيمات والتخصصات','تغيّر زخارف وهوية المنصة كاملة حسب تخصصك، وتعمل بشكل مستقل عن لون المنصة والوضع الليلي أو النهاري.','يُفعّل ثيم واحد فقط']
  }[group];
  if(!info)return '';
  return `<section class="section-explainer"><span class="section-explainer-icon">${icon(info[0])}</span><div><h2>${info[1]}</h2><p>${info[2]}</p><small>${icon('circle-check')} ${info[3]}</small></div></section>`;
}
function store() {
  return `<div class="inner store-page">${heading('متجر ميثاق','استخدم نقاطك لتخصيص تجربتك.')}${pointsWallet()}
  <section class="panel store-theme-entry"><span class="tile-icon">${icon('palette')}</span><div><h2>المظهر والثيمات</h2><p class="bodycopy">الوضع ${profile?.appearance?.mode==='dark'?'الليلي':'النهاري'} · ${palettes[profile?.appearance?.palette || 'emerald'].label}، وثيمات تخصصية كاملة.</p></div>${button('appearanceMenu','تخصيص المظهر','secondary','sliders-horizontal')}</section>
  <div class="filters">${sections.map((label,i)=>button('filter',label,sectionGroups[i]===category?'selected':'','',sectionGroups[i])).join('')}</div>
  ${storeSectionIntro(category)}
  ${shopItems(category)}</div>`;
}
function inventoryPage(){
  const owned=Object.entries(items).filter(([key,[group]])=>(group===2?Boolean(profile?.cosmetics?.[key]):(profile?.inventory?.[key]||0)>0)||Object.values(profile?.equipped||{}).includes(key));
  return `<div class="inner store-page">${heading('المخزون','كل مشترياتك وعناصرك في مكان واحد.')}
    ${owned.length?`<div class="store-grid inventory-grid">${owned.map(([key,[group,label,,symbol,desc]])=>{const count=profile?.inventory?.[key]||0;const equipped=Object.values(profile?.equipped||{}).includes(key);const expiry=profile?.cosmetics?.[key];return `<article class="panel inventory-item"><div class="inventory-visual" style="--art:${storeArt[key]}"><span class="product-icon-3d">${icon(symbol)}${icon(symbol)}</span></div><div class="inventory-copy"><h3>${label}</h3><p class="bodycopy">${desc}</p><span class="tag">${equipped?'مفعّل':expiry?'متاح حتى '+new Date(expiry).toLocaleDateString('ar-SA-u-nu-latn'):num(count)+' في المخزون'}</span></div>${[1,2,4,5].includes(group)?button('equip',equipped?'إلغاء التفعيل':'استخدم','secondary','power',key):button('useInventory','استخدم قطعة واحدة','primary','play',key)}</article>`;}).join('')}</div>`:'<section class="panel empty-state">'+icon('package-open')+'<h2>مخزونك فارغ</h2><p class="bodycopy">ستظهر هنا العناصر التي تشتريها من المتجر.</p></section>'}</div>`;
}
const gregorianNoteDate=value=>new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn',{dateStyle:'long'}).format(new Date(Number(value)));
const hijriNoteDate=value=>new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura-nu-latn',{dateStyle:'long'}).format(new Date(Number(value)));
const appointmentDate=value=>new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn',{dateStyle:'medium',timeStyle:'short'}).format(new Date(Number(value)));
const universityTerms = [
  ['الفصل الأول', [
    ['إعادة القيد والفرص الإضافية','2026-06-14','2026-06-16'],
    ['طلبات التحويل الخارجي','2026-06-17','2026-06-21'],
    ['التقديم على التحويل الداخلي','2026-08-09','2026-08-12'],
    ['طلبات تأجيل الدراسة','2026-08-10','2026-08-12'],
    ['تسجيل المقررات والحذف والإضافة','2026-08-16','2026-08-18'],
    ['طلبات الزيارة','2026-08-16','2026-08-20'],
    ['معادلة المقررات الدراسية','2026-08-16','2026-08-20'],
    ['عودة أعضاء هيئة التدريس','2026-08-16'],
    ['بداية الدراسة','2026-08-23'],
    ['آخر موعد لرفع نتائج الاختبارات البديلة','2026-08-27'],
    ['إجازة اليوم الوطني','2026-09-23','2026-09-26'],
    ['بداية إجازة منتصف الفصل (نهاية الدوام)','2026-11-19'],
    ['استئناف الدراسة بعد إجازة منتصف الفصل','2026-11-29'],
    ['آخر موعد للاعتذار عن الفصل أو مقرر','2026-12-10'],
    ['الاختبارات النهائية','2026-12-20','2027-01-07'],
    ['بداية إجازة منتصف العام (نهاية الدوام)','2027-01-07']
  ]],
  ['الفصل الثاني', [
    ['إعادة القيد والفرص الإضافية','2027-01-07','2027-01-10'],
    ['التقديم على التحويل الداخلي','2027-01-11','2027-01-13'],
    ['طلبات تأجيل الدراسة','2027-01-11','2027-01-13'],
    ['طلبات التحويل الخارجي','2027-01-11','2027-01-13'],
    ['طلبات الزيارة','2027-01-11','2027-01-13'],
    ['تسجيل المقررات والحذف والإضافة','2027-01-14','2027-01-18'],
    ['بداية الدراسة','2027-01-17'],
    ['معادلة المقررات الدراسية','2027-01-17','2027-01-21'],
    ['آخر موعد لرفع نتائج الاختبارات البديلة','2027-01-25'],
    ['إجازة يوم التأسيس','2027-02-19','2027-02-22'],
    ['بداية إجازة عيد الفطر (نهاية الدوام)','2027-02-25'],
    ['استئناف الدراسة بعد إجازة عيد الفطر','2027-03-14'],
    ['بداية إجازة عيد الأضحى (نهاية الدوام)','2027-05-06'],
    ['آخر موعد للاعتذار عن الفصل أو مقرر','2027-05-27'],
    ['الاختبارات النهائية','2027-05-30','2027-06-17'],
    ['بداية إجازة العام الدراسي (نهاية الدوام)','2027-06-17'],
    ['عودة أعضاء هيئة التدريس','2027-08-15'],
    ['بداية الدراسة للعام الجامعي 1449–1450','2027-08-22']
  ]],
  ['الفصل الصيفي', [
    ['التسجيل والحذف والإضافة','2027-06-06','2027-06-17'],
    ['بداية الدراسة','2027-06-20'],
    ['بداية الاختبارات النهائية','2027-08-15'],
    ['نهاية الاختبارات','2027-08-17'],
    ['إغلاق أعمال الفصل الصيفي','2027-08-17']
  ]]
];
function countdownText(target, now = Date.now()) {
  const remaining = target - now;
  if (remaining <= 0) return 'مضى';
  const hours = Math.floor(remaining / 3600000);
  return hours ? `${num(Math.floor(hours / 24))} يوم · ${hours % 24} ساعة` : 'أقل من ساعة';
}
function countdown(target, label = 'المتبقي') {
  return `<span class="countdown-chip"><small>${label}</small><strong data-countdown="${target}">${countdownText(target)}</strong></span>`;
}
const universityEventTypes = [
  ['holiday','إجازة','palmtree',/إجازة/],
  ['exam','اختبارات','clipboard-list',/اختبارات/],
  ['deadline','موعد نهائي','clock-3',/آخر موعد/],
  ['registration','إجراءات أكاديمية','file-text',/تسجيل|إضافة|طلبات|تحويل|قيد|معادلة/],
  ['study','الدراسة','book-open',/.*/]
];
function universityPage() {
  const today = appointmentDayKey(Date.now());
  const terms = universityTerms.map(([name, events]) => `
    <details class="university-term">
      <summary>${name} <small>· ${num(events.length)} موعد</small>${icon('chevron-down')}</summary>
      ${events.map(([title, start, end]) => {
        const [type, category, symbol] = universityEventTypes.find(([, , , pattern]) => pattern.test(title));
        const active = end && start <= today && today <= end;
        const ended = (end || start) < today;
        const target = Date.parse((active ? end : start) + (active ? 'T23:59:59+03:00' : 'T00:00:00+03:00'));
        const label = ended ? '<span class="countdown-chip">انتهى</span>' : !end && start === today ? '<span class="countdown-chip">اليوم</span>' : countdown(target, active ? 'حتى نهاية الفترة' : 'حتى الموعد');
        return `<article class="university-date${ended?' is-ended':''}" data-event-type="${type}"><div><span class="university-category">${icon(symbol)}${category}</span><strong>${esc(title)}</strong>
          <time datetime="${start}" dir="ltr">${start}</time>${end ? ` إلى <time datetime="${end}" dir="ltr">${end}</time>` : ''}
          </div>${label}</article>`;
      }).join('')}
    </details>`).join('');
  return `<div class="inner appointments-page">${heading('تقويم جامعة نجران','العام الجامعي 1448–1449 هـ')}<section class="panel stack university-calendar">${terms}</section></div>`;
}
const absenceRules = {75:{rate:192,limit:13},100:{rate:256,limit:10}};
function openAbsenceCalculator() {
  modal('احسب غيابي','الحسبة لمادة تُدرّس 3 أيام بالأسبوع، والحدود تقريبية.',`
    <form id="absence-calculator" class="stack">
      <label class="field">مدة المحاضرة
        <select name="duration">
          <option value="75">ساعة و15 دقيقة</option>
          <option value="100">ساعة و40 دقيقة</option>
        </select>
      </label>
      <label class="field">عدد المحاضرات التي غبت عنها
        <input name="absences" type="number" inputmode="numeric" min="0" max="999" step="1" value="0" required>
      </label>
      <output aria-live="polite"></output>
    </form>${button('close','إغلاق','secondary')}`);
  updateAbsenceResult(dialog.querySelector('#absence-calculator'));
}
function updateAbsenceResult(form) {
  const count = form.elements.absences.valueAsNumber;
  const {rate,limit} = absenceRules[form.elements.duration.value];
  const output = form.querySelector('output');
  if (!form.elements.absences.validity.valid) {
    output.textContent = 'أدخل عددًا صحيحًا من 0 إلى 999.';
    return;
  }
  const percent = Math.min(100,count*rate/100).toFixed(2);
  output.textContent = `نسبة الغياب ${percent}% · الحد التقريبي ${limit} مرات · ${count > limit ? 'تجاوزت العدد التقريبي' : `المتبقي ${limit-count}`}`;
}
dialog.addEventListener('input',event=>{
  const form = event.target.closest('#absence-calculator');
  if(form) updateAbsenceResult(form);
});
dialog.addEventListener('submit',event=>{
  if(event.target.id==='absence-calculator') event.preventDefault();
});
const appointmentDayFormatter = new Intl.DateTimeFormat('en-CA',{calendar:'gregory',numberingSystem:'latn',year:'numeric',month:'2-digit',day:'2-digit',timeZone:'Asia/Riyadh'});
function appointmentDayKey(value) {
  const parts = Object.fromEntries(appointmentDayFormatter.formatToParts(Number(value)).map(({type,value})=>[type,value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
const hijriParts=value=>Object.fromEntries(new Intl.DateTimeFormat('en-US-u-ca-islamic-umalqura-nu-latn',{year:'numeric',month:'numeric',day:'numeric',timeZone:'Asia/Riyadh'}).formatToParts(value).filter(part=>['year','month','day'].includes(part.type)).map(part=>[part.type,Number(part.value)]));
const hijriMonths=['محرّم','صفر','ربيع الأول','ربيع الآخر','جمادى الأولى','جمادى الآخرة','رجب','شعبان','رمضان','شوّال','ذو القعدة','ذو الحجة'];
function hijriDateToTimestamp(year,month,day,time){const formatter=new Intl.DateTimeFormat('en-US-u-ca-islamic-umalqura-nu-latn',{year:'numeric',month:'numeric',day:'numeric',timeZone:'Asia/Riyadh'}),start=Date.UTC(year+578,0,1),end=Date.UTC(year+581,0,1);for(let value=start;value<end;value+=86400000){const parts=Object.fromEntries(formatter.formatToParts(value).filter(part=>['year','month','day'].includes(part.type)).map(part=>[part.type,Number(part.value)]));if(parts.year===year&&parts.month===month&&parts.day===day){const gregorian=new Intl.DateTimeFormat('en-CA',{year:'numeric',month:'2-digit',day:'2-digit',timeZone:'Asia/Riyadh'}).format(value);return new Date(gregorian+'T'+time+':00+03:00').getTime();}}return NaN;}
function appointmentForm(){const now=new Date(),tomorrow=new Date(now.getTime()+86400000),hijri=hijriParts(tomorrow),gregorian=[tomorrow.getFullYear(),String(tomorrow.getMonth()+1).padStart(2,'0'),String(tomorrow.getDate()).padStart(2,'0')].join('-');return `<form id="appointment-dialog-form" class="appointment-form appointment-dialog-form"><div class="calendar-choice" role="radiogroup" aria-label="نوع التاريخ"><label><input type="radio" name="calendar" value="gregorian" checked><span>${icon('calendar-days')} ميلادي</span></label><label><input type="radio" name="calendar" value="hijri"><span>${icon('moon')} هجري</span></label></div><label class="field appointment-full">اسم الموعد<input name="title" maxlength="80" placeholder="مثال: اختبار الأحياء" required></label><label class="field gregorian-date">اليوم<input name="gregorianDate" type="date" value="${gregorian}" required></label><div class="hijri-date" hidden><label class="field">اليوم<input name="hijriDay" type="number" inputmode="numeric" min="1" max="30" value="${hijri.day}"></label><label class="field">الشهر<select name="hijriMonth">${hijriMonths.map((month,index)=>`<option value="${index+1}" ${index+1===hijri.month?'selected':''}>${month}</option>`).join('')}</select></label><label class="field">السنة<input name="hijriYear" type="number" inputmode="numeric" min="1400" max="1600" value="${hijri.year}"></label></div><label class="field">الوقت<input name="time" type="time" value="09:00" required></label><label class="field appointment-details appointment-full">تفاصيل اختيارية<textarea name="details" maxlength="240" placeholder="المكان أو المطلوب تحضيره"></textarea></label><div class="actions appointment-full"><button class="primary">${icon('calendar-plus')} حفظ الموعد</button>${button('close','إلغاء','secondary')}</div></form>`;}
async function loadAppointments(){if(appointmentsBusy||!socket?.connected)return;appointmentsBusy=true;try{const result=await socket.timeout(8000).emitWithAck('appointmentsList',{});if(result.error)throw new Error(result.error);appointmentsData=result.appointments||[];}catch(error){toast(error.message||'تعذّر تحميل المواعيد.');appointmentsData=[];}finally{appointmentsBusy=false;if(tab==='appointments')render(true);}}
function liquidCalendar(entries){const today=appointmentDayKey(Date.now());if(!calendarCursor){const [year,month]=today.split('-').map(Number);calendarCursor={year,month};calendarSelected=today;}const {year,month}=calendarCursor,firstDay=new Date(Date.UTC(year,month-1,1)).getUTCDay(),days=new Date(Date.UTC(year,month,0)).getUTCDate(),monthDate=new Date(Date.UTC(year,month-1,15)),title=new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn',{month:'long',year:'numeric',timeZone:'UTC'}).format(monthDate),hijriTitle=new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura-nu-latn',{month:'long',year:'numeric',timeZone:'UTC'}).format(monthDate),events=new Map();for(const item of entries){const key=appointmentDayKey(item.due_at);if(!events.has(key))events.set(key,[]);events.get(key).push(item);}const selectedEvents=events.get(calendarSelected)||[],selectedLabel=new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn',{weekday:'long',day:'numeric',month:'long',timeZone:'UTC'}).format(new Date(calendarSelected+'T12:00:00Z'));return `<section class="liquid-calendar"><div class="calendar-glow one"></div><div class="calendar-glow two"></div><header class="calendar-head"><div><small>${hijriTitle}</small><h2>${title}</h2></div><nav aria-label="التنقل بين الأشهر"><button type="button" data-action="calendarMove" data-value="-1" aria-label="الشهر السابق">${icon('chevron-right')}</button><button type="button" data-action="calendarToday">اليوم</button><button type="button" data-action="calendarMove" data-value="1" aria-label="الشهر التالي">${icon('chevron-left')}</button></nav></header><div class="calendar-weekdays">${['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'].map(day=>`<span>${day.slice(0,2)}</span>`).join('')}</div><div class="calendar-grid">${'<i></i>'.repeat(firstDay)}${Array.from({length:days},(_,index)=>{const day=index+1,key=`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`,count=events.get(key)?.length||0;return `<button type="button" data-action="calendarSelect" data-value="${key}" class="${key===today?'is-today ':''}${key===calendarSelected?'is-selected ':''}${count?'has-events':''}" aria-label="${day}${count?'، '+count+' مواعيد':''}"><span>${day}</span>${count?`<b>${count>3?'3+':count}</b>`:''}</button>`;}).join('')}</div><div class="calendar-agenda"><div class="agenda-head"><div><small>اليوم المحدد</small><strong>${selectedLabel}</strong></div><span>${num(selectedEvents.length)} موعد</span></div>${selectedEvents.length?`<div class="agenda-chips">${selectedEvents.map(item=>`<button type="button" data-action="confirmDeleteAppointment" data-value="${item.id}"><time>${new Intl.DateTimeFormat('en-US',{hour:'numeric',minute:'2-digit',hour12:true,timeZone:'Asia/Riyadh'}).format(new Date(item.due_at))}</time><strong>${esc(item.title)}</strong></button>`).join('')}</div>`:'<p class="agenda-empty">يوم هادئ — لا توجد مواعيد.</p>'}</div></section>`;}
function appointmentsPage(){const entries=appointmentsData||[],upcoming=entries.filter(item=>!item.completed),completed=entries.filter(item=>item.completed);const rows=list=>list.map(item=>`<article class="panel appointment-card ${item.completed?'is-completed':''}"><button type="button" class="appointment-check" data-action="toggleAppointment" data-value="${item.id}" aria-label="${item.completed?'إعادة الموعد':'إنجاز الموعد'}">${icon(item.completed?'circle-check-big':'circle')}</button><div><strong>${esc(item.title)}</strong><time>${icon('calendar-clock')} ${appointmentDate(item.due_at)}</time>${item.details?`<p>${esc(item.details)}</p>`:''}</div><div class="event-countdown">${item.completed?'':countdown(Number(item.due_at))}${button('confirmDeleteAppointment','حذف','plain','trash-2',item.id)}</div></article>`).join('');return `<div class="inner appointments-page">${heading('أحداثي','مواعيدك الشخصية والوقت المتبقي عليها.')}${liquidCalendar(entries)}<button type="button" class="primary wide add-appointment" data-action="newAppointment">${icon('calendar-plus')} أضف حدث</button>${appointmentsData===null?'<section class="panel">جارٍ تحميل مواعيدك…</section>':`<section class="appointments-group"><div class="appointments-title"><h2>القادمة</h2><span>${num(upcoming.length)}</span></div><div class="appointments-list">${rows(upcoming)||'<div class="panel appointments-empty">'+icon('calendar-check')+'<p>لا توجد مواعيد قادمة.</p></div>'}</div></section>${completed.length?`<details class="completed-appointments"><summary>المواعيد المنجزة (${num(completed.length)})</summary><div class="appointments-list">${rows(completed)}</div></details>`:''}`}</div>`;}
async function loadNotes(){if(notesBusy||!socket?.connected)return;notesBusy=true;try{const result=await socket.timeout(8000).emitWithAck('notesList',{});if(result.error)throw new Error(result.error);notesData={notes:result.notes||[],folders:result.folders||[]};}catch(error){toast(error.message||'تعذّر تحميل الملاحظات.');notesData={notes:[],folders:[]};}finally{notesBusy=false;if(tab==='notes')render(true);}}
function notesPage(){
  const groups=new Map(),folderIds=new Map(),notes=notesData?.notes||[],folders=notesData?.folders||[];for(const folder of folders){if(!groups.has(folder.subject))groups.set(folder.subject,new Map());groups.get(folder.subject).set(folder.chapter,[]);folderIds.set(folder.subject+'\0'+folder.chapter,folder.id);}for(const note of notes){if(!groups.has(note.subject))groups.set(note.subject,new Map());const chapters=groups.get(note.subject);if(!chapters.has(note.chapter))chapters.set(note.chapter,[]);chapters.get(note.chapter).push(note);}
  return `<div class="inner notes-page">${heading('الملاحظات','صور السبورة مرتبة حسب المادة والشابتر، من دون أن تضيع في ألبوم الجوال.')}
    <div class="notes-toolbar">${button('newNoteFolder','إنشاء مجلد','primary','folder-plus')}</div><form id="note-upload-form" class="panel note-upload stack"><div class="note-upload-title"><span class="tile-icon">${icon('camera')}</span><div><h2>رفع صور</h2><p class="bodycopy">اختر مجلدًا أو استخدم الإضافة السريعة بلا بيانات.</p></div></div><label class="field">المجلد<select name="folder"><option value="">اختر المادة والشابتر</option>${folders.map(folder=>`<option value="${esc(folder.id)}">${esc(folder.subject)} — ${esc(folder.chapter)}</option>`).join('')}</select></label><label class="note-file">${icon('image-up')}<span>اختر صور السبورة</span><input name="images" type="file" accept="image/jpeg,image/png,image/webp" multiple required></label><div class="actions"><button class="primary" value="folder">${icon('upload')} رفع داخل المجلد</button><button class="secondary" value="quick">${icon('zap')} إضافة سريعة</button></div><p class="upload-status" aria-live="polite"></p></form>
    <p class="folder-swipe-hint">${icon('move-right')} اسحب مجلد الشابتر لليمين لحذفه</p><div class="notes-folders">${notesData===null?'<section class="panel">جارٍ تحميل ملاحظاتك…</section>':[...groups].map(([subject,chapters])=>`<section class="panel subject-folder"><div class="folder-title"><span>${icon('folder')}<strong>${esc(subject)}</strong></span><div class="folder-actions"><small>${num([...chapters.values()].flat().length)} صورة</small>${button('subjectPdf','عرض PDF','secondary','file-down',encodeURIComponent(subject))}</div></div>${[...chapters].map(([chapter,notes])=>`<details class="chapter-folder swipe-folder" ${folderIds.get(subject+'\0'+chapter)?`data-folder-id="${folderIds.get(subject+'\0'+chapter)}"`:''} open><summary>${icon('book-open')}<strong>${esc(chapter)}</strong><small>${num(notes.length)}</small></summary><div class="note-grid">${notes.map(note=>`<article class="note-card"><img ${note.image_data?`src="${note.image_data}"`:`data-note-image="${note.id}"`} alt="ملاحظة ${esc(subject)} - ${esc(chapter)}" loading="lazy"><div><time>${gregorianNoteDate(note.created_at)}</time><small>${hijriNoteDate(note.created_at)}</small></div>${button('confirmDeleteNote','حذف','plain','trash-2',note.id)}</article>`).join('')}</div></details>`).join('')}</section>`).join('')||'<section class="panel empty-state">'+icon('images')+'<h2>لا توجد ملاحظات بعد</h2><p class="bodycopy">ارفع أول صورة وحدد مادتها وشابترها.</p></section>'}</div></div>`;
}
async function fetchNoteImage(note){if(note.image_data)return note.image_data;const result=await socket.timeout(12000).emitWithAck('notesImage',{note:note.id});if(result.error)throw new Error(result.error);note.image_data=result.image;return result.image;}
function hydrateNoteImages(){const images=[...page.querySelectorAll('[data-note-image]')];if(!images.length)return;const observer=new IntersectionObserver(entries=>{for(const entry of entries){if(!entry.isIntersecting)continue;observer.unobserve(entry.target);const note=notesData?.notes.find(item=>item.id===entry.target.dataset.noteImage);if(note)fetchNoteImage(note).then(image=>{entry.target.src=image;entry.target.removeAttribute('data-note-image');}).catch(()=>entry.target.classList.add('load-error'));}},{rootMargin:'180px'});images.forEach(image=>observer.observe(image));}
let noteViewerState=null;
const viewerClamp=(value,min,max)=>Math.min(max,Math.max(min,value));
function closeNoteViewer(){document.querySelector('.note-viewer')?.remove();noteViewerState=null;document.body.classList.remove('viewer-open');}
function applyNoteViewerTransform(){const image=document.querySelector('.note-viewer-image');if(!image||!noteViewerState)return;image.style.transform=`translate3d(${noteViewerState.x}px,${noteViewerState.y}px,0) scale(${noteViewerState.zoom})`;const value=document.querySelector('.note-viewer-zoom');if(value)value.textContent=Math.round(noteViewerState.zoom*100)+'%';}
function resetNoteViewerTransform(){if(!noteViewerState)return;noteViewerState.zoom=1;noteViewerState.x=0;noteViewerState.y=0;applyNoteViewerTransform();}
async function showNoteViewerImage(index){const state=noteViewerState;if(!state)return;state.index=(index+state.entries.length)%state.entries.length;resetNoteViewerTransform();const note=state.entries[state.index],image=document.querySelector('.note-viewer-image'),counter=document.querySelector('.note-viewer-counter'),title=document.querySelector('.note-viewer-title');if(!image)return;image.classList.add('is-loading');try{image.src=await fetchNoteImage(note);await image.decode();image.classList.remove('is-loading');counter.textContent=`${num(state.index+1)} / ${num(state.entries.length)}`;title.textContent=note.subject+' — '+note.chapter;[-1,1].forEach(step=>fetchNoteImage(state.entries[(state.index+step+state.entries.length)%state.entries.length]).catch(()=>{}));}catch{closeNoteViewer();toast('تعذّر فتح الصورة.');}}
async function saveVisibleNoteCrop(){const state=noteViewerState,viewer=document.querySelector('.note-viewer');if(!state||!viewer)return;const image=viewer.querySelector('.note-viewer-image'),stage=viewer.querySelector('.note-viewer-stage'),button=viewer.querySelector('[data-viewer-action="crop"]');const imageRect=image.getBoundingClientRect(),stageRect=stage.getBoundingClientRect(),left=Math.max(imageRect.left,stageRect.left),top=Math.max(imageRect.top,stageRect.top),right=Math.min(imageRect.right,stageRect.right),bottom=Math.min(imageRect.bottom,stageRect.bottom);if(right-left<10||bottom-top<10)return toast('كبّر الجزء الذي تريد قصه أولًا.');const sx=(left-imageRect.left)/imageRect.width*image.naturalWidth,sy=(top-imageRect.top)/imageRect.height*image.naturalHeight,sw=(right-left)/imageRect.width*image.naturalWidth,sh=(bottom-top)/imageRect.height*image.naturalHeight,outputScale=Math.min(1,1400/Math.max(sw,sh)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(sw*outputScale));canvas.height=Math.max(1,Math.round(sh*outputScale));canvas.getContext('2d').drawImage(image,sx,sy,sw,sh,0,0,canvas.width,canvas.height);const data=canvas.toDataURL('image/webp',.76),note=state.entries[state.index];button.disabled=true;try{const result=await socket.timeout(15000).emitWithAck('notesImageUpdate',{note:note.id,image:data});if(result.error)throw new Error(result.error);note.image_data=data;document.querySelector(`.note-card [data-note-image="${note.id}"]`)?.removeAttribute('data-note-image');const cardButton=document.querySelector(`.note-card [data-action="confirmDeleteNote"][data-value="${note.id}"]`),cardImage=cardButton?.closest('.note-card')?.querySelector('img');if(cardImage)cardImage.src=data;image.src=data;await image.decode();resetNoteViewerTransform();toast('تم حفظ قص الصورة.');}catch(error){toast(error.message||'تعذّر حفظ القص.');}finally{button.disabled=false;}}
async function openNoteViewer(noteId){const selected=notesData?.notes.find(note=>note.id===noteId);if(!selected)return;const entries=notesData.notes.filter(note=>note.subject===selected.subject).sort((a,b)=>a.created_at-b.created_at);closeNoteViewer();noteViewerState={entries,index:entries.findIndex(note=>note.id===noteId),zoom:1,x:0,y:0,pointers:new Map(),startX:0,startY:0,lastDistance:0};const viewer=document.createElement('div');viewer.className='note-viewer';viewer.setAttribute('role','dialog');viewer.setAttribute('aria-modal','true');viewer.innerHTML=`<header class="note-viewer-header"><button type="button" data-viewer-action="close" aria-label="إغلاق">${icon('x')}</button><div><strong class="note-viewer-title"></strong><small class="note-viewer-counter"></small></div><button type="button" data-viewer-action="crop">${icon('crop')} حفظ القص</button></header><div class="note-viewer-stage"><img class="note-viewer-image" alt="الصورة المكبرة" draggable="false"><button class="note-viewer-arrow previous" type="button" data-viewer-action="previous" aria-label="الصورة السابقة">${icon('chevron-right')}</button><button class="note-viewer-arrow next" type="button" data-viewer-action="next" aria-label="الصورة التالية">${icon('chevron-left')}</button></div><footer class="note-viewer-controls"><button type="button" data-viewer-action="zoomOut" aria-label="تصغير">${icon('minus')}</button><button type="button" data-viewer-action="reset" class="note-viewer-zoom">100%</button><button type="button" data-viewer-action="zoomIn" aria-label="تكبير">${icon('plus')}</button><span>قرّب بإصبعين أو مرّر بين الصور</span></footer>`;document.body.append(viewer);document.body.classList.add('viewer-open');viewer.addEventListener('click',event=>{const action=event.target.closest('[data-viewer-action]')?.dataset.viewerAction;if(!action)return;if(action==='close')closeNoteViewer();else if(action==='previous')showNoteViewerImage(noteViewerState.index-1);else if(action==='next')showNoteViewerImage(noteViewerState.index+1);else if(action==='zoomIn'){noteViewerState.zoom=viewerClamp(noteViewerState.zoom+.25,1,5);applyNoteViewerTransform();}else if(action==='zoomOut'){noteViewerState.zoom=viewerClamp(noteViewerState.zoom-.25,1,5);if(noteViewerState.zoom===1){noteViewerState.x=0;noteViewerState.y=0;}applyNoteViewerTransform();}else if(action==='reset')resetNoteViewerTransform();else if(action==='crop')saveVisibleNoteCrop();});const stage=viewer.querySelector('.note-viewer-stage');stage.addEventListener('pointerdown',event=>{if(event.target.closest('button'))return;stage.setPointerCapture(event.pointerId);const state=noteViewerState;state.pointers.set(event.pointerId,{x:event.clientX,y:event.clientY,previousX:event.clientX,previousY:event.clientY});if(state.pointers.size===1){state.startX=event.clientX;state.startY=event.clientY;}if(state.pointers.size===2){const points=[...state.pointers.values()];state.lastDistance=Math.hypot(points[0].x-points[1].x,points[0].y-points[1].y);}});stage.addEventListener('pointermove',event=>{const state=noteViewerState,point=state?.pointers.get(event.pointerId);if(!point)return;point.x=event.clientX;point.y=event.clientY;if(state.pointers.size===2){const points=[...state.pointers.values()],distance=Math.hypot(points[0].x-points[1].x,points[0].y-points[1].y);if(state.lastDistance)state.zoom=viewerClamp(state.zoom*distance/state.lastDistance,1,5);state.lastDistance=distance;applyNoteViewerTransform();}else if(state.zoom>1){state.x+=event.clientX-point.previousX;state.y+=event.clientY-point.previousY;applyNoteViewerTransform();}point.previousX=event.clientX;point.previousY=event.clientY;});const finishPointer=event=>{const state=noteViewerState,point=state?.pointers.get(event.pointerId);if(!point)return;state.pointers.delete(event.pointerId);if(!state.pointers.size&&state.zoom===1&&Math.abs(point.x-state.startX)>65&&Math.abs(point.x-state.startX)>Math.abs(point.y-state.startY)*1.25)showNoteViewerImage(state.index+(point.x<state.startX?1:-1));state.lastDistance=0;};stage.addEventListener('pointerup',finishPointer);stage.addEventListener('pointercancel',finishPointer);stage.addEventListener('wheel',event=>{event.preventDefault();noteViewerState.zoom=viewerClamp(noteViewerState.zoom+(event.deltaY<0?.2:-.2),1,5);if(noteViewerState.zoom===1){noteViewerState.x=0;noteViewerState.y=0;}applyNoteViewerTransform();},{passive:false});await showNoteViewerImage(noteViewerState.index);}
async function pdfImage(data){const image=new Image();image.src=data;await image.decode();const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0);return {data:canvas.toDataURL('image/jpeg',.86),width:canvas.width,height:canvas.height};}
async function prepareSubjectPdf(subject){try{await Promise.all((notesData?.notes||[]).filter(note=>note.subject===subject).map(fetchNoteImage));return subjectPdf(subject);}catch{return toast('تعذّر تحميل صور ملف PDF.');}}
async function subjectPdf(subject){const entries=(notesData?.notes||[]).filter(note=>note.subject===subject).sort((a,b)=>a.created_at-b.created_at);if(!entries.length)return toast('لا توجد صور لهذه المادة.');const PDF=window.jspdf?.jsPDF;if(!PDF)return toast('تعذّر تشغيل عارض PDF.');const preview=window.open('','_blank');try{const pdf=new PDF({unit:'mm',format:'a4',compress:true});for(let index=0;index<entries.length;index++){if(index)pdf.addPage();const image=await pdfImage(entries[index].image_data);const ratio=Math.min(190/image.width,277/image.height);const width=image.width*ratio,height=image.height*ratio;pdf.addImage(image.data,'JPEG',(210-width)/2,(297-height)/2,width,height,undefined,'FAST');}const url=pdf.output('bloburl');if(preview)preview.location.href=url;else pdf.save(subject+'.pdf');setTimeout(()=>URL.revokeObjectURL(url),60000);}catch(error){preview?.close();toast('تعذّر إنشاء ملف PDF.');}}
function settingsPage(){const cards=Object.entries(specialties).map(([key,[label,symbol,first,second]])=>{const selected=profile?.equipped?.decoration===key;const locked=(key==='eternal'&&profile?.plan?.tier!=='special')||!isPaid();return `<button type="button" class="theme-gallery-card specialty-choice" data-action="${locked?'seePlans':'equip'}" data-value="${key}" aria-pressed="${selected}" style="--theme-a:${first};--theme-b:${second}"><span class="theme-status">${locked?icon('lock-keyhole'):''}</span><span class="theme-mini specialty-mini">${icon(symbol)}</span><strong>${label}</strong>${locked?'<small>مميّز</small>':''}</button>`;}).join('');return `<div class="inner settings-page">${heading('الإعدادات','المظهر وثيمات تخصصك في مكان واحد.')}<section class="panel appearance-overview"><div><h2>المظهر والألوان</h2><p class="bodycopy">${profile?.appearance?.mode==='dark'?'ليلي':'نهاري'} · ${palettes[profile?.appearance?.palette||'emerald'].label}</p></div>${button('appearanceMenu','تخصيص المظهر','secondary','sliders-horizontal')}</section><section class="panel gallery-section"><div class="gallery-title"><h2>ثيمات التخصصات</h2><small>اختر هوية تناسب تخصصك</small></div><div class="theme-gallery-grid specialty-gallery">${cards}</div></section></div>`;}
function shopItems(groupIndex) {
  const p = profile;
  return `<p class="bodycopy section-rule">${icon('layers')} ${[1,2,4,5].includes(groupIndex)?'في هذا القسم يُفعّل منتج واحد فقط.':'في هذا القسم يُستخدم منتج واحد في كل مرة.'}</p>
    <div class="store-grid product-grid">${Object.entries(items).filter(([key,x])=>key!=='marathon' && x[0]===groupIndex).map(([key,[group,label,cost,symbol,desc]])=>{
    const count = p?.inventory[key] || 0;
    const expires = p?.cosmetics?.[key];
    const collectible = [1,2,4,5].includes(group);
    const specialLocked=specialOnly.has(key)&&profile?.plan?.tier!=='special';
    const membershipLocked=premiumOnly.has(key)&&!isPaid();
    const locked=specialLocked||membershipLocked;
    const included=[1,2,4].includes(group)&&isPaid();
    const available = !locked&&collectible && (included || (group===2 ? expires : count));
    const equipped = Object.values(p?.equipped || {}).includes(key);
    const detail = specialLocked?'حصري لعضوية سبيشل':membershipLocked?'متاح مع برو وسبيشل':included ? 'مشمول في العضوية' : group===2 && expires
      ? 'متاح حتى '+new Date(expires).toLocaleDateString('ar-u-nu-latn') : num(cost)+' نقطة'+(group===2?' · صالح 3 أيام':count?' · في المخزون '+num(count):'');
    return `<article class="panel store-item ${locked?'premium-locked':''}">${locked?'<span class="premium-lock">'+icon('lock-keyhole')+(specialLocked?' سبيشل':' برو وسبيشل')+'</span>':''}
      <div class="store-art art-${key}" style="--art:${storeArt[key]}"><span class="product-icon-3d">${icon(symbol)}${icon(symbol)}</span></div>
      <h3>${label}</h3><p class="bodycopy">${desc}</p><span class="gold">${detail}</span>
      <div class="store-controls">${locked?button('seePlans',specialLocked?'فتح مع سبيشل':'فتح مع العضوية','secondary','lock-keyhole'):available?button('equip',equipped?'إلغاء التفعيل':'تفعيل',equipped?'primary':'secondary','',key):`
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
        return `<details class="admin-student"><summary><span><strong>${esc(student.name)}</strong><small>${esc(student.handle?'@'+student.handle+' · ':'')}${esc(student.id)}</small></span><span class="admin-student-status">${status} · ${num(student.points)} نقطة ${icon('chevron-down')}</span></summary>
        <div class="admin-student-details">${student.temporaryPoints?`<p class="bodycopy">${icon('clock-3')} ${num(student.temporaryPoints)} نقطة مؤقتة · أقرب انتهاء ${new Date(student.temporaryUntil).toLocaleDateString('ar-SA-u-nu-latn')}</p>`:''}
        <form class="actions admin-student-form" data-student="${esc(student.id)}">
          ${!student.banned && student.plan.tier!=='special'?`<select name="plan" aria-label="الباقة"><option value="pro">برو</option><option value="special">سبيشل</option></select><button class="secondary" value="grant">${icon('circle-check')} فعّل</button>`:''}
          ${plan?button('confirmAdminRevoke','إزالة العضوية','danger','user-round-minus',student.id):''}
          ${!student.banned?`<input name="points" type="number" min="1" step="1" inputmode="numeric" placeholder="عدد النقاط" aria-label="عدد النقاط">
          <select name="validDays" aria-label="صلاحية النقاط"><option value="0">دائمة</option><option value="1">يوم واحد</option><option value="3">3 أيام</option><option value="7">أسبوع</option><option value="14">أسبوعان</option><option value="30">شهر</option></select>
          <button class="secondary" value="points">${icon('sparkles')} إضافة</button><button class="danger" value="removePoints">${icon('circle-minus')} إزالة</button>`:''}
          ${!student.admin?`<button class="${student.banned?'secondary':'danger'}" value="${student.banned?'unban':'ban'}">${student.banned?'رفع الحظر':'حظر'}</button>`:''}
        </form></div></details>`;
      }).join('') || '<p class="bodycopy">'+(adminData?'لم تظهر حسابات مطابقة.':'جارٍ تحميل الحسابات…')+'</p>'}</section>
    <section class="panel stack"><h2>أكواد العضوية</h2><p class="bodycopy">كل كود يفعّل العضوية لحساب واحد.</p>
      <form id="admin-code-form" class="actions"><label>الباقة <select name="plan"><option value="pro">برو</option><option value="special">سبيشل</option></select></label>
      <button class="primary">${icon('ticket-plus')} أنشئ كودًا</button></form>
      ${codes.map(entry=>`<div class="admin-row admin-code-row"><div><code dir="ltr">${esc(entry.code)}</code><p class="bodycopy">${plans[entry.plan]?.title} · <span class="${entry.redeemed_by?'code-expired':'code-active'}">${entry.redeemed_by?'منتهي':'متاح لاستخدام واحد'}</span></p></div>
      <div class="actions">${!entry.redeemed_by?button('adminCopy','نسخ الكود','secondary','copy',entry.code):''}${button('confirmAdminDeleteCode','حذف','danger','trash-2',entry.code)}</div></div>`).join('')}</section></div></div>`;
}

let appearanceSnapFrame;
function snapAppearance(){
  const root=document.documentElement;
  const request=++appearanceSnapFrame;
  root.classList.add('appearance-snap');
  requestAnimationFrame(()=>requestAnimationFrame(()=>{if(request===appearanceSnapFrame)root.classList.remove('appearance-snap');}));
}
function changeAppearance(next) {
  if(!profile?.appearance)return;
  const previous={...profile.appearance};
  const request=++appearanceRequest;
  visualUpdatePending=true;
  snapAppearance();
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
      if(request===appearanceRequest){visualUpdatePending=false;snapAppearance();profile.appearance=previous;applyAppearance();openAppearance();}
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
dialog.addEventListener('change',event=>{if(event.target.name!=='calendar')return;const form=event.target.closest('#appointment-dialog-form'),hijri=event.target.value==='hijri';form.querySelector('.gregorian-date').hidden=hijri;form.querySelector('.gregorian-date input').required=!hijri;form.querySelector('.hijri-date').hidden=!hijri;form.querySelectorAll('.hijri-date input,.hijri-date select').forEach(input=>input.required=hijri);});
dialog.addEventListener('submit',async event=>{
  if(event.target.id!=='appointment-dialog-form')return;event.preventDefault();if(appointmentsBusy)return;const formElement=event.target,data=new FormData(formElement),calendar=data.get('calendar'),time=data.get('time'),dueAt=calendar==='hijri'?hijriDateToTimestamp(Number(data.get('hijriYear')),Number(data.get('hijriMonth')),Number(data.get('hijriDay')),time):new Date(data.get('gregorianDate')+'T'+time+':00+03:00').getTime();if(!Number.isFinite(dueAt))return toast('تحقق من اليوم والتاريخ المختار.');appointmentsBusy=true;const submit=event.submitter;submit.disabled=true;try{const result=await socket.timeout(8000).emitWithAck('appointmentAdd',{title:data.get('title'),details:data.get('details'),dueAt});if(result.error)throw new Error(result.error);appointmentsData=[...(appointmentsData||[]),result.appointment].sort((a,b)=>a.completed-b.completed||a.due_at-b.due_at);calendarSelected=appointmentDayKey(dueAt);const [year,month]=calendarSelected.split('-').map(Number);calendarCursor={year,month};dialog.close();render(true);toast('تمت إضافة الموعد.');}catch(error){toast(error.message||'تعذّرت إضافة الموعد.');submit.disabled=false;}finally{appointmentsBusy=false;}
});

async function toggleEquip(item) {
  if(!profile?.equipped||!items[item])return;
  const category=items[item][0];
  const slot=category===5?'celebration':category===4?'decoration':category===1?'theme':item==='frame'?'frame':'title';
  const previous={...profile.equipped};
  profile.equipped={...profile.equipped,[slot]:profile.equipped[slot]===item?null:item};
  if(category===2&&profile.equipped[slot])delete profile.equipped[slot==='title'?'frame':'title'];
  if(category===4&&appearanceOpen&&dialog.open)dialog.querySelectorAll('.specialty-choice').forEach(card=>card.setAttribute('aria-pressed',String(card.dataset.value===profile.equipped.decoration)));
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
  const modes={light:['أبيض','sun','#f5f5f2','#ffffff'],dark:['داكن','moon','#111316','#292d33']};
  dialog.innerHTML = `<div class="stack appearance-gallery"><div class="appearance-head"><div><small>تخصيص المنصة</small><h2>المظهر</h2></div>${button('close','إغلاق','plain','x')}</div>
    <section class="appearance-card gallery-section"><h3>وضع العرض</h3><div class="theme-gallery-grid">${Object.entries(modes).map(([mode,[label,symbol,base,layer]])=>
      `<button type="button" class="theme-gallery-card mode-choice" data-action="mode" data-value="${mode}" aria-pressed="${mode===appearance.mode}" style="--theme-a:${base};--theme-b:${layer}"><span class="theme-status"></span><span class="theme-mini">${icon(symbol)}</span><strong>${label}</strong></button>`).join('')}</div></section>
    <section class="appearance-card gallery-section"><h3>ألوان المنصة</h3><div class="theme-gallery-grid">${Object.entries(palettes).filter(([key])=>key!=='custom' || profile?.appearance?.custom).map(([key,palette])=>{
      const locked = palette.premium && !isPaid();
      const selected=appearance.palette===key;
      const fill=key==='custom'?customFill(appearance.custom):palette.swatch;
      return `<button type="button" class="theme-gallery-card palette-choice" data-action="palette" data-value="${key}" aria-pressed="${selected}" style="--theme-fill:${fill}"><span class="theme-status">${locked?icon('lock-keyhole'):''}</span><span class="theme-mini palette-mini"></span><strong>${palette.label}</strong>${locked?'<small>مميّز</small>':''}</button>`;
    }).join('')}</div>${!isPaid()?'<p class="gallery-note">الزمردي والأزرق متاحان للجميع، وبقية المظاهر للمشتركين.</p>':''}</section>
    ${isPaid()?customPaletteForm(appearance.custom):''}
    <section class="appearance-card glass-settings">
      <label for="glass-range">${icon(isPaid()?'droplets':'lock-keyhole')} شفافية الزجاج <output id="glass-value" for="glass-range">${num(appearance.transparency)}٪</output></label>
      <input id="glass-range" type="range" min="${glassRange.min}" max="${glassRange.max}" value="${appearance.transparency}" ${isPaid()?'':'disabled aria-describedby="glass-lock"'}>
      ${isPaid()?'':'<p class="bodycopy" id="glass-lock">تحكّم بالشفافية مع برو وسبيشل.</p>'}
    </section>
    ${button('resetAppearance','استعادة المظهر الافتراضي','secondary','rotate-ccw')}
    ${button('startTour','إعادة الجولة التعريفية','plain','map')}
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
    if (b.dataset.tab===tab || (tab==='rooms' && b.closest('.dock') && b.dataset.tab==='home')) b.setAttribute('aria-current','page'); else b.removeAttribute('aria-current');
  });
  const phase = !revisited && room?.phase;
  const key = [tab,phase,room?.id,isInvite()].join('|');
  if (force || key!==viewKey || ['active','lobby','outcome'].includes(phase)) {
    const content = blocked ? '<div class="inner">'+heading('الحساب محظور','تواصل مع مشرف ميثاق للمساعدة.')+'</div>' : tab==='dashboard'?dashboard():tab==='admin'?adminPage():tab==='rooms'?roomsPage():tab==='university'?universityPage():tab==='appointments'?appointmentsPage():tab==='settings'?settingsPage():tab==='plans'?plansPage():phase==='lobby'?lobby():phase==='active'?active():phase==='outcome'?outcome():home();
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
  updateClock();
}
function formatClock(seconds) {
  return [Math.floor(seconds/60),seconds%60].map(value=>String(value).padStart(2,'0')).join(':');
}
function updateClock() {
  const countdownNow = Date.now();
  document.querySelectorAll('[data-countdown]').forEach(element=>{
    const label = countdownText(Number(element.dataset.countdown),countdownNow);
    if (element.textContent!==label) element.textContent=label;
  });
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
  const completed=!counting&&!paused&&value===0;
  digits.textContent = completed?'✓':counting ? String(value) : formatClock(value);
  document.querySelector('#dial-label').textContent = completed?'اكتملت الجلسة':counting?'تبدأ الجلسة خلال':paused?'وقت الاستراحة':'الوقت المتبقي';
  const focusRemaining = counting ? room.endAt-room.startsAt : room.endAt-(paused ? room.pauseUntil : now);
  digits.closest('.dial').style.setProperty('--progress',dialProgress(focusRemaining/60000));
}
setInterval(updateClock,100);
function modal(title,text,buttons) {
  dialog.innerHTML = `<div class="stack"><h2>${title}</h2><p class="bodycopy">${text}</p><div class="actions">${buttons}</div></div>`;
  if (!dialog.open) dialog.showModal();
}
async function submitGoalResult(done){
  if(!socket?.connected)return toast('الاتصال غير متاح حاليًا.');
  try{
    const response=await socket.timeout(6000).emitWithAck('result',{done});
    if(response?.error)throw new Error(response.error);
    if(done){
      revisited=true;socket.emit('dismissOutcome',{},()=>{});room=null;tab='home';render(true);window.scrollTo({top:0,behavior:'instant'});
    }else{
      modal('نكمل الهدف بجلسة جديدة؟','ما أنجزته اليوم خطوة ممتازة. أنشئ غرفة جديدة وأكمل هدفك مع شريك تركيز.',button('newGoalSession','إنشاء غرفة جديدة','primary','plus')+button('close','البقاء هنا','secondary'));
    }
  }catch(error){toast(error.message||'تعذّر حفظ إجابتك.');}
}
const vibe = () => {
  if (tg?.initData) tg.HapticFeedback?.impactOccurred('medium');
  else navigator.vibrate?.(120);
};
function showGiftMoment(data={}) {
  const labels={coffee:['coffee','كوب قهوة'],zap:['zap','صعقة تركيز'],horn:['sparkles','بوق الفوز']};
  const [symbol,label]=labels[data.item]||['gift','هدية'];
  document.querySelector('.gift-moment')?.remove();
  const moment=document.createElement('div');
  moment.className='gift-moment';
  moment.setAttribute('role','status');
  moment.innerHTML=`<div class="gift-confetti" aria-hidden="true">${'<i></i>'.repeat(12)}</div><div class="gift-orbit">${icon(symbol)}</div><small>${esc(data.from)} أهدى ${esc(data.to)}</small><strong>${label}</strong><span>وصلت اللفتة بنجاح</span>`;
  document.body.append(moment);
  vibe();
  setTimeout(()=>{moment.classList.add('leaving');setTimeout(()=>moment.remove(),450);},3400);
}
function invitePanel(){
  if(room.members.length===2)return '';
  return `<section class="panel stack invite-options"><h2>طرق دعوة إضافية</h2><p class="bodycopy">أضف شريكك داخل ميثاق أو شاركه رمز الغرفة.</p>
    <div class="invite-code"><label>رمز الغرفة<input id="invite-code" dir="ltr" value="${esc(room.code)}" readonly></label>${button('copyCode','نسخ الرمز','secondary','copy')}</div>
    ${tg?.initData?`<form id="direct-invite-form" class="join-code"><label class="field">إضافة بالمعرف<input name="handle" dir="ltr" placeholder="@username" maxlength="33" required></label><button class="secondary">${icon('user-round-plus')} إضافة</button></form>`:''}
    <p class="bodycopy invite-reward-note">${icon('gift')} بمجرد انضمام صديقك، تحصلان على ${num(referralPoints)} نقطة لكل واحد.</p></section>`;
}
function showCopied(control){
  if(!control)return;
  const original=control.innerHTML;
  control.classList.add('copy-success');
  control.innerHTML=icon('check')+' تم النسخ';
  clearTimeout(control._copyTimer);
  control._copyTimer=setTimeout(()=>{if(control.isConnected){control.classList.remove('copy-success');control.innerHTML=original;}},1800);
}
async function copyInvite(selector, message, control) {
  const field = document.querySelector(selector);
  if (!field) return;
  try {
    await navigator.clipboard.writeText(field.value);
    showCopied(control);
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
    tg.shareMessage(messageId,sent=>{if(sent){if(dialog.open)dialog.close();toast('أُرسلت الدعوة.');}});
  } catch {
    toast('تعذّر فتح مشاركة الدعوة. جرّب مرة أخرى.');
  } finally {
    preparingInvite = false;
    button.disabled = false;
  }
}
document.addEventListener('click',event=>{
  if (blocked) return;
  const nav = event.target.closest('[data-tab]');
  if (nav) {
    if (room?.phase==='active' && nav.dataset.tab!=='home') return toast('التنقل متاح بعد انتهاء جلسة التركيز.');
    if (tab!==nav.dataset.tab) {
      tab=nav.dataset.tab;
      render();
      if(tab==='appointments'&&appointmentsData===null)loadAppointments();
      window.scrollTo({top:0,behavior:'instant'});
    }
    return;
  }
  const b = event.target.closest('[data-action]');
  if (!b) return;
  const {action,value}=b.dataset;
  if(action==='tourNext'){
    if(tourIndex>=tourSteps.length-1)endTour(true);else{tourIndex++;showTourStep();}
  } else if(action==='tourPrevious'){tourIndex=Math.max(0,tourIndex-1);showTourStep();}
  else if(action==='tourSkip')endTour(true);
  else if(action==='startTour')startTour();
  else if(action==='absenceCalculator')openAbsenceCalculator();
  else if (action==='duration') {
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
  else if(action==='backPage'){tab='home';render();window.scrollTo({top:0,behavior:'instant'});}
  else if(action==='startTrial')emit('startTrial');
  else if (action==='openAdmin') {
    if (!profile?.admin || room?.phase==='active') return;
    if (dialog.open) dialog.close();
    tab='admin'; render(); window.scrollTo({top:0,behavior:'instant'});
    adminRequest('adminList',{search:adminSearch});
  }
  else if (action==='confirmAdminRevoke') modal('إزالة العضوية','سيعود الحساب إلى الباقة المجانية.',button('adminRevoke','إزالة العضوية','danger','user-round-minus',value)+button('close','رجوع','secondary'));
  else if (action==='adminRevoke') { dialog.close(); adminRequest('adminRevoke',{student:value}); }
  else if(action==='confirmAdminDeleteCode')modal('حذف الكود','سيُحذف الكود نهائيًا من لوحة الإدارة.',button('adminDeleteCode','حذف الكود','danger','trash-2',value)+button('close','رجوع','secondary'));
  else if(action==='adminDeleteCode'){dialog.close();adminRequest('adminDeleteCode',{code:value});}
  else if(action==='calendarMove'){let month=calendarCursor.month+Number(value),year=calendarCursor.year;if(month<1){month=12;year--;}if(month>12){month=1;year++;}calendarCursor={year,month};calendarSelected=`${year}-${String(month).padStart(2,'0')}-01`;render(true);}
  else if(action==='calendarToday'){const today=appointmentDayKey(Date.now()),[year,month]=today.split('-').map(Number);calendarCursor={year,month};calendarSelected=today;render(true);}
  else if(action==='calendarSelect'){calendarSelected=value;render(true);tg?.HapticFeedback?.selectionChanged();}
  else if(action==='newAppointment'){dialog.innerHTML=`<div class="appointment-dialog-head"><span class="tile-icon">${icon('calendar-plus')}</span><div><h2>إضافة موعد</h2><p class="bodycopy">اختر التقويم واليوم والوقت.</p></div></div>${appointmentForm()}`;if(!dialog.open)dialog.showModal();}
  else if(action==='toggleAppointment'){socket.timeout(6000).emitWithAck('appointmentToggle',{appointment:value}).then(result=>{if(result.error)throw new Error(result.error);const item=appointmentsData?.find(entry=>entry.id===value);if(item)item.completed=result.completed;appointmentsData?.sort((a,b)=>a.completed-b.completed||a.due_at-b.due_at);render(true);toast(result.completed?'تم إنجاز الموعد.':'أُعيد الموعد إلى القائمة.');}).catch(error=>toast(error.message||'تعذّر تحديث الموعد.'));}
  else if(action==='confirmDeleteAppointment')modal('حذف الموعد','سيُحذف هذا الموعد نهائيًا.',button('deleteAppointment','حذف الموعد','danger','trash-2',value)+button('close','رجوع','secondary'));
  else if(action==='deleteAppointment'){dialog.close();socket.timeout(6000).emitWithAck('appointmentDelete',{appointment:value}).then(result=>{if(result.error)throw new Error(result.error);appointmentsData=appointmentsData.filter(item=>item.id!==value);render(true);toast('تم حذف الموعد.');}).catch(error=>toast(error.message||'تعذّر حذف الموعد.'));}
  else if (action==='adminCopy') {
    navigator.clipboard?.writeText(value).then(()=>toast('نُسخ الكود.'),()=>toast('حدد الكود وانسخه يدويًا.'));
  }
  else if (action==='goHome') { if(room?.phase==='outcome'){revisited=true;emit('dismissOutcome');room=null;}tab='home'; render(true); window.scrollTo({top:0,behavior:'instant'}); }
  else if (action==='activityDay') { activityDay=value; render(true); }
  else if (action==='copyReferralCode') copyInvite('#my-referral-code','نُسخ كود دعوتك.',b);
  else if (action==='copyReferralLink' || action==='shareReferral') shareReferral(action==='copyReferralLink');
  else if (action==='checkout') checkout(value,b);
  else if (action==='ignore') { inviteDismissed=true; render(true); }
  else if (action==='invite') shareInvite(b);
  else if (action==='copyInvite') copyInvite('#invite-url','نُسخ رابط الدعوة.',b);
  else if (action==='copyCode') {const field=document.querySelector('#invite-code');if(field)copyInvite('#invite-code','نُسخ رمز الغرفة.',b);else navigator.clipboard?.writeText(room?.code||'').then(()=>{showCopied(b);toast('نُسخ رمز الغرفة.');});}
  else if (action==='acceptInvite') {
    if (!incomingInvite || (room && room.phase!=='outcome')) return;
    if(dialog.open)dialog.close();
    invite=incomingInvite.code; incomingInvite=null; inviteDismissed=false;
    revisited=room?.phase==='outcome'; tab='rooms'; render(true);
    window.scrollTo({top:0,behavior:'instant'});
  } else if (action==='dismissInvite') { if(dialog.open)dialog.close();incomingInvite=null;render(true); }
  else if (action==='filter') { category=+value; render(true); }
  else if (action==='withdraw') modal('هل تريد الانسحاب؟','يُسجّل الانسحاب وتُخصم حتى 20 نقطة من رصيدك.',button('confirmWithdraw','تأكيد الانسحاب','danger')+button('close','متابعة التركيز','secondary'));
  else if (action==='close') dialog.close();
  else if (action==='confirmWithdraw') { dialog.close(); emit('withdraw'); }
  else if (action==='reset') { revisited=true;emit('dismissOutcome');room=null;tab='home';render(true); }
  else if (action==='outcomeBreak') emit('outcomeBreak');
  else if (action==='answerPause') emit(action,{accept:value==='yes'});
  else if (action==='result') submitGoalResult(value==='yes');
  else if (action==='newGoalSession') {if(dialog.open)dialog.close();revisited=true;emit('dismissOutcome');room=null;tab='home';render(true);window.scrollTo({top:0,behavior:'instant'});}
  else emit(action,{item:value});
});
page.addEventListener('pointerdown',event=>{
  const dialControl=event.target.closest('.interactive-dial');
  if(!dialControl)return;
  event.preventDefault();dialControl.setPointerCapture?.(event.pointerId);
  let candidate=chosen;
  let dragAngle=durationDialProgress(chosen)*3.6;
  const pointerAngle=pointer=>{
    const rect=dialControl.getBoundingClientRect();
    let angle=Math.atan2(pointer.clientY-(rect.top+rect.height/2),pointer.clientX-(rect.left+rect.width/2))*180/Math.PI+90;
    return angle<0?angle+360:angle;
  };
  let lastPointerAngle=pointerAngle(event);
  const select=pointer=>{
    const angle=pointerAngle(pointer);
    let delta=angle-lastPointerAngle;
    if(delta>180)delta-=360;
    if(delta< -180)delta+=360;
    dragAngle=Math.max(0,Math.min(360,dragAngle+delta));
    lastPointerAngle=angle;
    candidate=Math.max(5,Math.min(180,Math.round((5+dragAngle/360*175)/5)*5));
    dialControl.style.setProperty('--progress',durationDialProgress(candidate));
    const handle=dialControl.querySelector('.dial-handle');if(handle)handle.style.cssText=dialHandlePosition(durationDialProgress(candidate));
    dialControl.setAttribute('aria-valuenow',candidate);
    dialControl.querySelector('.digits').textContent=candidate+':00';
  };
  const move=pointer=>select(pointer);
  const end=()=>{
    window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',end);
    if(candidate>=120&&!isPaid()){render(true);return premiumDuration(candidate);}
    chosen=candidate;render(true);tg?.HapticFeedback?.selectionChanged();
  };
  window.addEventListener('pointermove',move);window.addEventListener('pointerup',end,{once:true});
});
page.addEventListener('input',event=>{
  if (event.target.name==='goal') goal=event.target.value;
  if (event.target.name==='pact') pact=event.target.value;
  if (page.querySelector('#create-session-form')) page.dataset.content=home();
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
    if(event.target.id==='direct-invite-form'){emit('directInvite',{handle:form.get('handle')});return;}
    const code=form.get('code').trim().toUpperCase();
    if (!/^[A-F0-9]{8}$/.test(code)) return toast('اكتب رمز الغرفة المكوّن من 8 حروف وأرقام.');
    if(room?.phase==='lobby'&&room.code===code&&room.members.some(member=>member.id===user?.id)){
      tab='home';inviteDismissed=true;render(true);window.scrollTo({top:0,behavior:'instant'});toast('هذه غرفتك، أعدناك إلى غرفة الانتظار.');return;
    }
    invite=code;inviteDismissed=false;emit('join',{code,goal:''});
    return;
  }
  if (!['create-session-form','join-session-form'].includes(event.target.id)) return;
  event.preventDefault();
  if(event.target.id==='join-session-form')emit('join',{code:invite,goal});
  else emit('create',{minutes:chosen,goal});
});
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
  if (dialog.open) dialog.close();
  toast(message);
  render(true);
}
socket.on('banned',showBan);
socket.on('connect_error',error=>{
  if (error.message==='حُظر هذا الحساب من استخدام ميثاق.') showBan(error.message);
});
socket.on('connect',()=>{
  if(/timeout|الاتصال|انقطع/i.test(notice.textContent))notice.textContent='';
});
function updateProfile(data) {
  const bonus = profile ? data.referralBonus - profile.referralBonus : 0;
  if (bonus>0) toast('وصلتك '+num(bonus)+' نقطة من دعوة صديق.');
  const optimistic=visualUpdatePending&&profile?{appearance:profile.appearance,equipped:profile.equipped}:null;
  if(optimistic)data={...data,...optimistic};
  const changed = profile?.appearance?.mode !== data.appearance?.mode || profile?.appearance?.palette !== data.appearance?.palette || profile?.plan?.tier !== data.plan?.tier || profile?.adminAccess !== data.adminAccess || JSON.stringify(profile?.appearance?.custom) !== JSON.stringify(data.appearance?.custom);
  profile = data;
  if(user?.id){
    const cached={points:data.points,pointGrants:data.pointGrants,pointExpiry:data.pointExpiry,streak:data.streak,inventory:data.inventory,equipped:data.equipped,plan:data.plan,cosmetics:data.cosmetics,appearance:data.appearance,reliability:data.reliability,completed:data.completed,minutes:data.minutes,left:data.left,tourSeen:data.tourSeen,now:data.now};
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
  maybeStartTour();
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
  }
  if (previous?.phase==='active' && next?.phase!=='active') {
    if (dialog.open) dialog.close();
    tab='home';
  }
  render();
  if (tab==='home' && (previous?.id!==next?.id || previous?.phase!==next?.phase)) {
    window.scrollTo({top:0,behavior:'instant'});
  }
});
socket.on('directInvite', data=>{
  if (!room || room.phase==='outcome') {
    if (room?.phase==='outcome') revisited=true;
    showIncomingInvite(data);
  }
});
socket.on('signal',kind=>{
  if(kind==='nudge')return;
});
socket.on('giftMoment',showGiftMoment);
