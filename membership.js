import { randomBytes,randomUUID } from 'node:crypto';
import { defaultAppearance,glassRange,plans } from './public/catalog.js';

const day=86400000;
export const cosmeticDuration=3*day;
export const paidPrices=Object.fromEntries(Object.keys(plans).map(plan=>{
  const value=Number(process.env[plan.toUpperCase()+'_STARS']);
  return [plan,Number.isSafeInteger(value)&&value>0?value:0];
}));

export async function createMembership(db,now) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS memberships (player TEXT PRIMARY KEY,pro_until BIGINT NOT NULL DEFAULT 0,special INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS cosmetic_expiry (player TEXT NOT NULL,item TEXT NOT NULL,expires_at BIGINT NOT NULL,PRIMARY KEY(player,item));
    CREATE TABLE IF NOT EXISTS appearances (player TEXT PRIMARY KEY,mode TEXT NOT NULL,palette TEXT NOT NULL,transparency INTEGER NOT NULL DEFAULT ${glassRange.defaultValue});
    CREATE TABLE IF NOT EXISTS custom_palettes (player TEXT PRIMARY KEY,fill TEXT NOT NULL,first_color TEXT NOT NULL,second_color TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS membership_codes (code TEXT PRIMARY KEY,plan TEXT NOT NULL,created_by TEXT NOT NULL,created BIGINT NOT NULL,redeemed_by TEXT,redeemed_at BIGINT);
    CREATE TABLE IF NOT EXISTS membership_invoices (payload TEXT PRIMARY KEY,player TEXT NOT NULL,plan TEXT NOT NULL,amount INTEGER NOT NULL,created BIGINT NOT NULL,charge TEXT UNIQUE);
  `);
  const grant=async(player,plan)=>{
    const existing=await db.query('SELECT pro_until,special FROM memberships WHERE player=?',player);
    const special=plan==='special';
    const until=special?Number(existing?.pro_until||0):Math.max(Number(existing?.pro_until||0),now())+30*day;
    await db.run(`INSERT INTO memberships(player,pro_until,special) VALUES(?,?,?) ON CONFLICT(player) DO UPDATE SET
      pro_until=excluded.pro_until,special=CASE WHEN memberships.special>excluded.special THEN memberships.special ELSE excluded.special END`,player,until,Number(special));
  };
  const planStatus=async player=>{
    const row=await db.query('SELECT pro_until,special FROM memberships WHERE player=?',player);
    const until=Number(row?.pro_until||0);
    return Number(row?.special)?{tier:'special',until:null}:until>now()?{tier:'pro',until}:{tier:'free',until:null};
  };
  const invoiceMatches=(record,{user,amount,currency})=>record&&record.player===String(user)&&Number(record.amount)===amount&&currency==='XTR';
  return {
    planStatus,grant,
    async revoke(player){await db.run('DELETE FROM memberships WHERE player=?',player);},
    async customPalette(player){return db.query('SELECT fill,first_color AS first,second_color AS second FROM custom_palettes WHERE player=?',player);},
    async setCustomPalette(player,{fill,first,second}){await db.run(`INSERT INTO custom_palettes(player,fill,first_color,second_color) VALUES(?,?,?,?) ON CONFLICT(player) DO UPDATE SET fill=excluded.fill,first_color=excluded.first_color,second_color=excluded.second_color`,player,fill,first,second);},
    async codes(){return db.all('SELECT code,plan,created,redeemed_by FROM membership_codes ORDER BY created DESC LIMIT 30');},
    async createCode(admin,plan){for(;;){const code='MTHQ-'+randomBytes(8).toString('hex').toUpperCase();const saved=await db.run('INSERT INTO membership_codes(code,plan,created_by,created) VALUES(?,?,?,?) ON CONFLICT(code) DO NOTHING',code,plan,admin,now());if(saved.changes)return code;}},
    async redeemCode(player,code){return db.transaction(async()=>{const record=await db.query('SELECT plan,redeemed_by FROM membership_codes WHERE code=?'+(db.kind==='postgres'?' FOR UPDATE':''),code);if(!record||record.redeemed_by||(await planStatus(player)).tier==='special')return false;const used=await db.run('UPDATE membership_codes SET redeemed_by=?,redeemed_at=? WHERE code=? AND redeemed_by IS NULL',player,now(),code);if(!used.changes)return false;await grant(player,record.plan);return true;});},
    async appearance(player){return (await db.query('SELECT mode,palette,transparency FROM appearances WHERE player=?',player))||{...defaultAppearance};},
    async cosmetics(player){return Object.fromEntries((await db.all('SELECT item,expires_at FROM cosmetic_expiry WHERE player=? AND expires_at>?',player,now())).map(row=>[row.item,Number(row.expires_at)]));},
    async setAppearance(player,mode,palette,transparency){const existing=await db.query('SELECT transparency FROM appearances WHERE player=?',player);await db.run(`INSERT INTO appearances(player,mode,palette,transparency) VALUES(?,?,?,?) ON CONFLICT(player) DO UPDATE SET mode=excluded.mode,palette=excluded.palette,transparency=excluded.transparency`,player,mode,palette,transparency??existing?.transparency??glassRange.defaultValue);},
    async grantCosmetic(player,item){await db.run(`INSERT INTO cosmetic_expiry(player,item,expires_at) VALUES(?,?,?) ON CONFLICT(player,item) DO UPDATE SET expires_at=excluded.expires_at`,player,item,now()+cosmeticDuration);},
    async newInvoice(player,plan){const payload='membership_'+randomUUID();await db.run('INSERT INTO membership_invoices(payload,player,plan,amount,created) VALUES(?,?,?,?,?)',payload,player,plan,paidPrices[plan],now());return payload;},
    async validateCheckout(payload,payment){const record=await db.query('SELECT * FROM membership_invoices WHERE payload=?',payload);return Boolean(invoiceMatches(record,payment)&&!record.charge&&now()-Number(record.created)<=day&&(await planStatus(record.player)).tier!=='special');},
    async fulfill(payload,payment){return db.transaction(async()=>{const record=await db.query('SELECT * FROM membership_invoices WHERE payload=?'+(db.kind==='postgres'?' FOR UPDATE':''),payload);if(!invoiceMatches(record,payment)||!payment.charge||record.charge||await db.query('SELECT 1 FROM membership_invoices WHERE charge=?',payment.charge))return null;await db.run('UPDATE membership_invoices SET charge=? WHERE payload=? AND charge IS NULL',payment.charge,payload);await grant(record.player,record.plan);return record.player;});}
  };
}
