export const sections = ['الحماية والوقت','الأجواء والثيمات','الألقاب والشارات','التفاعلات'];
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
  coffee: [3,'كوب قهوة',40,'coffee','أرسل بطاقة قهوة لشريكك أثناء الجلسة.']
};

export const rewards = { achievement:45, cooperation:15, steadfast:25, withdrawal:20 };
export const successReward = rewards.achievement + rewards.cooperation;

export const defaultAppearance = { mode:'light', palette:'emerald' };

export const palettes = {
  emerald: { label:'زمردي', swatch:'#55dbae' },
  blue: { label:'أزرق', swatch:'#7cb9f7' },
  violet: { label:'بنفسجي', swatch:'#b59aff', premium:true },
  amber: { label:'كهرماني', swatch:'#f2b46f', premium:true },
  aurora: { label:'تدرّج الشفق', swatch:'linear-gradient(135deg,#8fe9cf,#9f9af9)', premium:true },
  dusk: { label:'تدرّج الغروب', swatch:'linear-gradient(135deg,#ffc888,#df99d9)', premium:true }
};

export const storeArt = {
  shield:'#65dfba', marathon:'#ffbb78', pause:'#e9a1cb', eraser:'#ac9cf6',
  rain:'#80bfff', cafe:'#f2be87', forest:'#91db9c', fire:'#ff976f',
  scholar:'#a6a5ff', owl:'#b5a1eb', steadfast:'#f9bf70', frame:'#f8d080',
  zap:'#f6dc65', horn:'#ef91b9', coffee:'#dfae8d'
};

export const plans = {
  pro: { title:'برو', duration:'٣٠ يومًا', icon:'crown', color:'#b8a0ff' },
  special: { title:'سبيشل', duration:'مدى الحياة', icon:'gem', color:'#f4c57c' }
};
