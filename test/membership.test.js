import assert from 'node:assert/strict';
import test from 'node:test';

test('expires cosmetics and Pro, preserves Special, and records each verified charge once',async()=>{
  process.env.PRO_STARS='50';process.env.SPECIAL_STARS='250';process.env.DATABASE_PATH=':memory:';
  const [{createMembership,cosmeticDuration},{createDatabase}]=await Promise.all([import('../membership.js'),import('../database.js')]);
  const db=await createDatabase();
  await db.exec(`CREATE TABLE players(id TEXT PRIMARY KEY,inventory TEXT);INSERT INTO players VALUES ('101','{"owl":1,"coffee":1}');`);
  let now=Date.now();const membership=await createMembership(db,()=>now);
  await membership.grantCosmetic('101','owl');assert.deepEqual(await membership.cosmetics('101'),{owl:now+cosmeticDuration});
  now+=cosmeticDuration;assert.deepEqual(await membership.cosmetics('101'),{});
  await membership.grantCosmetic('101','owl');assert.equal((await membership.cosmetics('101')).owl,now+cosmeticDuration);
  assert.deepEqual(await membership.appearance('101'),{mode:'light',palette:'emerald',transparency:24});
  await membership.setAppearance('101','dark','blue',42);await membership.setAppearance('101','light','blue');
  assert.deepEqual({...await membership.appearance('101')},{mode:'light',palette:'blue',transparency:42});
  const pro=await membership.newInvoice('101','pro');const payment={user:101,amount:50,currency:'XTR',charge:'first-charge'};
  assert.equal(await membership.validateCheckout(pro,{...payment,user:102}),false);assert.equal(await membership.validateCheckout(pro,payment),true);
  assert.equal(await membership.fulfill(pro,{...payment,currency:'USD'}),null);assert.equal(await membership.fulfill(pro,payment),'101');assert.equal(await membership.fulfill(pro,payment),null);
  const month=30*86400000;assert.deepEqual(await membership.planStatus('101'),{tier:'pro',until:now+month});
  const renewal=await membership.newInvoice('101','pro');await membership.fulfill(renewal,{...payment,charge:'renewal'});
  assert.deepEqual(await membership.planStatus('101'),{tier:'pro',until:now+2*month});now+=2*month;assert.equal((await membership.planStatus('101')).tier,'free');
  const special=await membership.newInvoice('101','special');assert.equal(await membership.fulfill(special,{...payment,amount:250,charge:'lifetime'}),'101');
  now+=100*month;assert.deepEqual(await membership.planStatus('101'),{tier:'special',until:null});await db.close();
});
