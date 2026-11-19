import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

test('expires cosmetics and Pro, preserves Special, and records each verified charge once', async () => {
  process.env.PRO_STARS = '50';
  process.env.SPECIAL_STARS = '250';
  const { createMembership,cosmeticDuration } = await import('../membership.js');
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE players(id TEXT PRIMARY KEY,inventory TEXT);
    INSERT INTO players VALUES ('101','{"owl":1,"coffee":1}');`);
  let now = Date.now();
  const membership = createMembership(db,()=>now);
  const transact = (fn) => {
    db.exec('BEGIN');
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  assert.deepEqual(membership.cosmetics('101'),{owl:now+cosmeticDuration});
  now += cosmeticDuration;
  assert.deepEqual(membership.cosmetics('101'),{});
  assert.deepEqual(createMembership(db,()=>now).cosmetics('101'),{});

  membership.grantCosmetic('101','owl');
  assert.equal(membership.cosmetics('101').owl,now+cosmeticDuration);
  membership.setAppearance('101','light','blue');
  assert.deepEqual({...membership.appearance('101')},{mode:'light',palette:'blue'});

  const pro = membership.newInvoice('101','pro');
  const payment = {user:101,amount:50,currency:'XTR',charge:'first-charge'};
  assert.equal(membership.validateCheckout(pro,{...payment,user:102}),false);
  assert.equal(membership.validateCheckout(pro,{...payment,amount:49}),false);
  assert.equal(membership.validateCheckout(pro,payment),true);
  assert.equal(membership.fulfill(pro,{...payment,currency:'USD'},transact),null);
  assert.equal(membership.fulfill(pro,payment,transact),'101');
  assert.equal(membership.fulfill(pro,payment,transact),null);
  assert.equal(membership.validateCheckout(pro,payment),false);
  const month = 30*86400000;
  assert.deepEqual(membership.planStatus('101'),{tier:'pro',until:now+month});

  const renewal = membership.newInvoice('101','pro');
  assert.equal(membership.fulfill(renewal,payment,transact),null);
  membership.fulfill(renewal,{...payment,charge:'renewal'},transact);
  assert.deepEqual(membership.planStatus('101'),{tier:'pro',until:now+2*month});
  now += 2*month;
  assert.equal(membership.planStatus('101').tier,'free');

  const special = membership.newInvoice('101','special');
  assert.equal(membership.fulfill(special,{...payment,amount:250,charge:'lifetime'},transact),'101');
  now += 100*month;
  assert.deepEqual(membership.planStatus('101'),{tier:'special',until:null});
  assert.equal(membership.validateCheckout(membership.newInvoice('101','pro'),payment),false);
  db.close();
});
