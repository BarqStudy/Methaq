export const sections = ['الحماية والوقت','الألقاب والشارات','التفاعلات','الثيمات والتخصصات','احتفاليات الإنجاز'];
export const sectionGroups = [0,2,3,4,5];
export const specialties = {
  medic: ['الطب','stethoscope','#48c7b8','#91d5e9'],
  engineer: ['الهندسة','drafting-compass','#eeb36f','#c998ef'],
  artist: ['الفنون','palette','#c5a3ff','#f5a2cc'],
  coder: ['البرمجة','terminal','#87aefa','#70d8c4'],
  pharmacy: ['الصيدلة','pill','#87d897','#c6d87b'],
  dentistry: ['طب الأسنان','smile','#8eddec','#adacfa'],
  nursing: ['التمريض','heart-pulse','#f89caa','#ffc482'],
  law: ['القانون','scale','#d6a778','#a8a9d7'],
  business: ['إدارة الأعمال','briefcase','#87b9fb','#af9af4'],
  architecture: ['العمارة','building-2','#edb29a','#e1c17a'],
  education: ['التربية','book-open','#bfa2ff','#8eceef'],
  psychology: ['علم النفس','brain','#efa7d2','#c2a3fd'],
  chemistry: ['الكيمياء','flask-conical','#8bd7c8','#9aaeff'],
  languages: ['اللغات','languages','#ffc48c','#f399b6'],
  accounting: ['المحاسبة','calculator','#a4d18b','#e8cf83'],
  eternal: ['سبيشل الأبدي','gem','#f0c36c','#a890ff']
};
export const items = {
  shield: [0,'درع الطوارئ',100,'shield','يحمي سلسلة التزامك عند الانسحاب أو انقطاع الاتصال.'],
  marathon: [0,'تذكرة الماراثون',120,'ticket','تفتح جلسة واحدة مدتها ١٢٠ دقيقة.'],
  pause: [0,'استراحة محارب',80,'coffee','استراحة ٣ دقائق بموافقة شريكك.'],
  eraser: [0,'ممحاة الانسحاب',300,'eraser','تزيل انسحابًا واحدًا من حساب نسبة الالتزام.'],
  scholar: [2,'دافور الدفعة',100,'graduation-cap','لقب يظهر بجوار اسمك.'],
  owl: [2,'بومة الليل',180,'moon','لقب يظهر بجوار اسمك.'],
  steadfast: [2,'صامد للنهاية',260,'award','لقب يظهر بجوار اسمك.'],
  frame: [2,'الإطار الذهبي',350,'circle-user-round','إطار ذهبي لصورتك الشخصية.'],
  earlybird: [2,'طائر الفجر',120,'sunrise','لمن يبدأ يومه بميثاق وتركيز مبكر.'],
  focused: [2,'عين على الهدف',140,'target','لقب هادئ لمن يعرف وجهته.'],
  timekeeper: [2,'حارس الوقت',240,'clock-3','شارة تقدّر كل دقيقة تركيز.'],
  deepwork: [2,'عقل عميق',280,'brain-circuit','لجلسات العمل العميق بلا مشتتات.'],
  duo_leader: [2,'قائد الثنائي',300,'users-round','لمن يصنع شراكات تركيز ناجحة.'],
  honor_badge: [2,'وسام الميثاق',320,'badge-check','شارة التزام مميزة بجوار اسمك.'],
  focus_star: [2,'نجم التركيز',350,'star','لقب لامع للمنجزين باستمرار.'],
  elite: [2,'نخبة المنجزين',400,'trophy','وسام نادر لأصحاب الإنجاز العالي.'],
  diamond_mind: [2,'العقل الماسي',450,'diamond','شارة فاخرة للتركيز الاستثنائي.'],
  legend: [2,'أسطورة التركيز',550,'crown','أندر ألقاب ميثاق وأكثرها هيبة.'],
  zap: [3,'صعقة التركيز',30,'zap','إشارة اهتزاز إضافية خلال الجلسة.'],
  horn: [3,'بوق الفوز',120,'megaphone','احتفل مع شريكك بعد النجاح.'],
  coffee: [3,'كوب قهوة',40,'coffee','أرسل بطاقة قهوة لشريكك أثناء الجلسة.'],
  celebrate_confetti: [5,'مهرجان القصاصات',70,'party-popper','قصاصات ملونة تنفجر حول إنجازك.'],
  celebrate_stars: [5,'مجرة النجوم',180,'sparkles','نجوم لامعة تدور حول بطاقة الإنجاز.'],
  celebrate_petals: [5,'بتلات النجاح',220,'flower-2','بتلات هادئة تتساقط احتفالًا بإنجازك.'],
  celebrate_rocket: [5,'انطلاقة الصاروخ',280,'rocket','صاروخ ينطلق بقوة بعد إتمام الجلسة.'],
  celebrate_crown: [5,'تتويج المنجز',350,'crown','لحظة تتويج ذهبية تليق بصمودك.'],
  celebrate_aurora: [5,'شفق الإنجاز',450,'wand-sparkles','موجات شفق وأضواء ساحرة تملأ الشاشة.'],
  ...Object.fromEntries(Object.entries(specialties).map(([id,[name,icon]]) =>
    [id,[4,name,95,icon,'أجواء '+name+' وزخارفه على كامل المنصة.']]))
};

export const rewards = { achievement:45, steadfast:25, withdrawal:20 };
export const successReward = rewards.achievement;
export const specialOnly = new Set(['eternal']);
// 34 of the 42 visible products (about 80%) require an active membership.
export const premiumOnly = new Set(['eraser','owl','steadfast','frame','timekeeper','deepwork','duo_leader','honor_badge','focus_star','elite','diamond_mind','legend','horn',
  'celebrate_stars','celebrate_petals','celebrate_rocket','celebrate_crown','celebrate_aurora',...Object.keys(specialties)]);

export const glassRange = { min:12, max:46, defaultValue:24 };
export const defaultAppearance = { mode:'light', palette:'emerald', transparency:glassRange.defaultValue };

export const palettes = {
  emerald: { label:'زمردي', swatch:'#55dbae' },
  blue: { label:'أزرق', swatch:'#7cb9f7' },
  violet: { label:'بنفسجي', swatch:'#b59aff', premium:true },
  amber: { label:'كهرماني', swatch:'#f2b46f', premium:true },
  aurora: { label:'تدرّج الشفق', swatch:'linear-gradient(135deg,#8fe9cf,#9f9af9)', premium:true },
  custom: { label:'ألواني', premium:true },
  dusk: { label:'تدرّج الغروب', swatch:'linear-gradient(135deg,#ffc888,#df99d9)', premium:true },
  ocean: { label:'محيط زجاجي', swatch:'linear-gradient(135deg,#9bf3e3,#7bafff)', premium:true },
  rose: { label:'ورد زجاجي', swatch:'linear-gradient(135deg,#ffc2d7,#ceadff)', premium:true }
};

export const storeArt = {
  shield:'#65dfba', marathon:'#ffbb78', pause:'#e9a1cb', eraser:'#ac9cf6',
  scholar:'#a6a5ff', owl:'#b5a1eb', steadfast:'#f9bf70', frame:'#f8d080',earlybird:'#f4b96d',focused:'#6fc9b0',timekeeper:'#75a9e8',deepwork:'#9a8ce8',duo_leader:'#65c9c0',honor_badge:'#e1ad62',focus_star:'#e8ca62',elite:'#db9b58',diamond_mind:'#72c8df',legend:'#d9a15c',
  zap:'#f6dc65', horn:'#ef91b9', coffee:'#dfae8d',celebrate_confetti:'#ff8fa8',celebrate_stars:'#8ca8ff',celebrate_petals:'#f3a9d0',celebrate_rocket:'#ff9a68',celebrate_crown:'#e9b64f',celebrate_aurora:'#9d8cff',
  ...Object.fromEntries(Object.entries(specialties).map(([id,[,,color]])=>[id,color]))
};

export const plans = {
  pro: { title:'برو', duration:'٣٠ يومًا', icon:'crown', color:'#b8a0ff' },
  special: { title:'سبيشل', duration:'مدى الحياة', icon:'gem', color:'#f4c57c' }
};

export const durations = [5,25,50,90,120,180];
export const referralPoints = 100;

export const breakMinutes = {25:5, 50:10, 90:12, 120:15, 180:20};
