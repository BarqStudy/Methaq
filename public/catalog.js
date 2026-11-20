export const sections = ['الحماية والوقت','الأجواء والثيمات','الألقاب والشارات','التفاعلات','الثيمات والتخصصات','احتفاليات الإنجاز'];
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
  eraser: [0,'ممحاة الانسحاب',150,'eraser','تزيل انسحابًا واحدًا من حساب نسبة الالتزام.'],
  rain: [1,'مطر منتصف الليل',80,'cloud-rain','أجواء زرقاء وصوت مطر هادئ.'],
  cafe: [1,'مقهى الفجر',80,'coffee','أجواء دافئة وهمهمة مقهى.'],
  forest: [1,'غابة الضباب',80,'trees','أجواء خضراء وحفيف هادئ.'],
  fire: [1,'مدفأة الشتاء',80,'flame','أجواء كهرمانية وطقطقة المدفأة.'],
  scholar: [2,'دافور الدفعة',100,'graduation-cap','لقب يظهر بجوار اسمك.'],
  owl: [2,'بومة الليل',100,'moon','لقب يظهر بجوار اسمك.'],
  steadfast: [2,'صامد للنهاية',120,'award','لقب يظهر بجوار اسمك.'],
  frame: [2,'الإطار الذهبي',150,'circle-user-round','إطار ذهبي لصورتك الشخصية.'],
  zap: [3,'صعقة التركيز',30,'zap','إشارة اهتزاز إضافية خلال الجلسة.'],
  horn: [3,'بوق الفوز',35,'megaphone','احتفل مع شريكك بعد النجاح.'],
  coffee: [3,'كوب قهوة',40,'coffee','أرسل بطاقة قهوة لشريكك أثناء الجلسة.'],
  celebrate_confetti: [5,'مهرجان القصاصات',70,'party-popper','قصاصات ملونة تنفجر حول إنجازك.'],
  celebrate_stars: [5,'مجرة النجوم',85,'sparkles','نجوم لامعة تدور حول بطاقة الإنجاز.'],
  celebrate_petals: [5,'بتلات النجاح',90,'flower-2','بتلات هادئة تتساقط احتفالًا بإنجازك.'],
  celebrate_rocket: [5,'انطلاقة الصاروخ',110,'rocket','صاروخ ينطلق بقوة بعد إتمام الجلسة.'],
  celebrate_crown: [5,'تتويج المنجز',130,'crown','لحظة تتويج ذهبية تليق بصمودك.'],
  celebrate_aurora: [5,'شفق الإنجاز',150,'wand-sparkles','موجات شفق وأضواء ساحرة تملأ الشاشة.'],
  ...Object.fromEntries(Object.entries(specialties).map(([id,[name,icon]]) =>
    [id,[4,name,95,icon,'أجواء '+name+' وزخارفه على كامل المنصة.']]))
};

export const rewards = { achievement:45, steadfast:25, withdrawal:20 };
export const successReward = rewards.achievement;
export const specialOnly = new Set(['eternal']);

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
  rain:'#80bfff', cafe:'#f2be87', forest:'#91db9c', fire:'#ff976f',
  scholar:'#a6a5ff', owl:'#b5a1eb', steadfast:'#f9bf70', frame:'#f8d080',
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
