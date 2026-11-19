import { randomBytes,randomUUID } from 'node:crypto';
import { defaultAppearance,glassRange,plans } from './public/catalog.js';

const day = 86400000;
export const cosmeticDuration = 3 * day;
export const paidPrices = Object.fromEntries(Object.keys(plans).map(plan => {
  const value = Number(process.env[plan.toUpperCase()+'_STARS']);
  return [plan,Number.isSafeInteger(value) && value > 0 ? value : 0];
}));

export function createMembership(db, now) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memberships (
      player TEXT PRIMARY KEY, pro_until INTEGER NOT NULL DEFAULT 0, special INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS cosmetic_expiry (
      player TEXT NOT NULL, item TEXT NOT NULL, expires_at INTEGER NOT NULL, PRIMARY KEY(player,item)
    );
    CREATE TABLE IF NOT EXISTS appearances (
      player TEXT PRIMARY KEY, mode TEXT NOT NULL, palette TEXT NOT NULL,
      transparency INTEGER NOT NULL DEFAULT ${glassRange.defaultValue}
    );
    CREATE TABLE IF NOT EXISTS membership_codes (
      code TEXT PRIMARY KEY, plan TEXT NOT NULL, created_by TEXT NOT NULL,
      created INTEGER NOT NULL, redeemed_by TEXT, redeemed_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS membership_invoices (
      payload TEXT PRIMARY KEY, player TEXT NOT NULL, plan TEXT NOT NULL, amount INTEGER NOT NULL,
      created INTEGER NOT NULL, charge TEXT UNIQUE
    );
  `);
  db.prepare(`INSERT OR IGNORE INTO cosmetic_expiry(player,item,expires_at)
    SELECT players.id, owned.key, ? FROM players, json_each(players.inventory) AS owned
    WHERE owned.value > 0 AND owned.key IN ('scholar','owl','steadfast','frame')`).run(now()+cosmeticDuration);

  if (!db.prepare('PRAGMA table_info(appearances)').all().some(column=>column.name==='transparency')) {
    db.exec(`ALTER TABLE appearances ADD COLUMN transparency INTEGER NOT NULL DEFAULT ${glassRange.defaultValue}`);
  }

  const readMembership = db.prepare('SELECT pro_until, special FROM memberships WHERE player=?');
  const readAppearance = db.prepare('SELECT mode,palette,transparency FROM appearances WHERE player=?');
  const readCosmetics = db.prepare('SELECT item,expires_at FROM cosmetic_expiry WHERE player=? AND expires_at>?');
  const findInvoice = db.prepare('SELECT * FROM membership_invoices WHERE payload=?');
  const addInvoice = db.prepare('INSERT INTO membership_invoices(payload,player,plan,amount,created) VALUES(?,?,?,?,?)');
  const saveCharge = db.prepare('UPDATE membership_invoices SET charge=? WHERE payload=? AND charge IS NULL');
  const findCharge = db.prepare('SELECT 1 FROM membership_invoices WHERE charge=?');
  const grantPlan = db.prepare(`INSERT INTO memberships(player,pro_until,special) VALUES(?,?,?)
    ON CONFLICT(player) DO UPDATE SET pro_until=excluded.pro_until,special=max(special,excluded.special)`);
  const setAppearance = db.prepare(`INSERT INTO appearances(player,mode,palette,transparency) VALUES(?,?,?,?)
    ON CONFLICT(player) DO UPDATE SET mode=excluded.mode,palette=excluded.palette,transparency=excluded.transparency`);
  const setCosmetic = db.prepare(`INSERT INTO cosmetic_expiry(player,item,expires_at) VALUES(?,?,?)
    ON CONFLICT(player,item) DO UPDATE SET expires_at=excluded.expires_at`);

  const addCode = db.prepare('INSERT OR IGNORE INTO membership_codes(code,plan,created_by,created) VALUES(?,?,?,?)');
  const findCode = db.prepare('SELECT plan,redeemed_by FROM membership_codes WHERE code=?');
  const useCode = db.prepare('UPDATE membership_codes SET redeemed_by=?,redeemed_at=? WHERE code=? AND redeemed_by IS NULL');
  const listCodes = db.prepare('SELECT code,plan,created,redeemed_by FROM membership_codes ORDER BY created DESC,rowid DESC LIMIT 30');

  function grant(player, plan) {
    const existing = readMembership.get(player);
    const special = plan === 'special';
    const until = special ? (existing?.pro_until || 0) : Math.max(existing?.pro_until || 0,now()) + 30*day;
    grantPlan.run(player,until,Number(special));
  }

  function planStatus(player) {
    const row = readMembership.get(player);
    const until = row?.pro_until || 0;
    return row?.special ? { tier:'special', until:null } : until > now()
      ? { tier:'pro', until } : { tier:'free', until:null };
  }

  function invoiceMatches(record, { user, amount, currency }) {
    return record && record.player === String(user) && record.amount === amount && currency === 'XTR';
  }

  return {
    planStatus,
    grant,
    codes() { return listCodes.all(); },
    createCode(admin, plan) {
      let code;
      do { code = 'MTHQ-'+randomBytes(8).toString('hex').toUpperCase(); }
      while (!addCode.run(code,plan,admin,now()).changes);
      return code;
    },
    redeemCode(player, code, transaction) {
      return transaction(() => {
        const record = findCode.get(code);
        if (!record || record.redeemed_by || planStatus(player).tier==='special') return false;
        if (!useCode.run(player,now(),code).changes) return false;
        grant(player,record.plan);
        return true;
      });
    },
    appearance(player) { return readAppearance.get(player) || { ...defaultAppearance }; },
    cosmetics(player) {
      return Object.fromEntries(readCosmetics.all(player,now()).map(row=>[row.item,row.expires_at]));
    },
    setAppearance(player, mode, palette, transparency) {
      setAppearance.run(player,mode,palette,transparency ?? readAppearance.get(player)?.transparency ?? glassRange.defaultValue);
    },
    grantCosmetic(player, item) { setCosmetic.run(player,item,now()+cosmeticDuration); },
    newInvoice(player, plan) {
      const payload = 'membership_'+randomUUID();
      addInvoice.run(payload,player,plan,paidPrices[plan],now());
      return payload;
    },
    validateCheckout(payload, payment) {
      const record = findInvoice.get(payload);
      return Boolean(invoiceMatches(record,payment) && !record.charge && now()-record.created <= day
        && planStatus(record.player).tier !== 'special');
    },
    fulfill(payload, payment, transaction) {
      return transaction(() => {
        const record = findInvoice.get(payload);
        if (!invoiceMatches(record,payment) || !payment.charge || record.charge || findCharge.get(payment.charge)) return null;
        saveCharge.run(payment.charge,payload);
        grant(record.player,record.plan);
        return record.player;
      });
    }
  };
}
