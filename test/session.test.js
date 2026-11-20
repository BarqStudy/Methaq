import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { io } from 'socket.io-client';

test('two-person pact synchronizes and settles rewards, purchases, and withdrawal', {timeout:10000}, async (t) => {
  process.env.DEV_GUESTS = '1';
  process.env.DATABASE_PATH = ':memory:';
  process.env.PORT = '0';
  process.env.RUN_BOT = '0';
  const {http,clock} = await import('../server.js');
  if (!http.listening) await once(http,'listening');
  const clients = [];
  t.after(() => { clients.forEach(socket=>socket.disconnect()); http.close(); });
  const now = Date.now;
  let offset = 0;
  clock.now = () => now()+offset;
  t.after(() => { clock.now=now; });
  async function guest(name) {
    const socket = io('http://localhost:'+http.address().port,{auth:{guest:randomUUID(),name}});
    clients.push(socket);
    await once(socket,'hello');
    return socket;
  }
  const command = (socket,event,payload={}) => socket.timeout(2500).emitWithAck(event,payload);
  const waitFor = (socket,event,predicate) => new Promise(resolve => {
    const listener = value => {
      if (!predicate(value)) return;
      socket.off(event,listener);
      resolve(value);
    };
    socket.on(event,listener);
  });
  const a = await guest('أحمد');
  assert.deepEqual(await command(a,'completeTour'),{ok:true});
  const tourProfile=waitFor(a,'profile',profile=>profile.tourSeen===true);
  assert.deepEqual(await command(a,'refreshProfile'),{ok:true});
  assert.equal((await tourProfile).tourSeen,true);
  assert.ok((await command(a,'appearance',{mode:'dark',palette:'aurora'})).error);
  assert.ok((await command(a,'appearance',{mode:'light',palette:'blue',transparency:40})).error);
  const appearance = waitFor(a,'profile',r=>r.appearance.palette==='blue');
  assert.deepEqual(await command(a,'appearance',{mode:'light',palette:'blue'}),{ok:true});
  assert.equal((await appearance).appearance.mode,'light');
  assert.ok((await command(a,'create',{minutes:120,goal:'مشروع'})).error);
  assert.ok((await command(a,'create',{minutes:180,goal:'مشروع'})).error);
  const b = await guest('ريم');
  const c = await guest('نور');
  assert.ok((await command(a,'create',{minutes:6,goal:'مدة غير صالحة'})).error);
  const shortRoom = waitFor(a,'room',r=>r.phase==='lobby'&&r.minutes===5);
  assert.deepEqual(await command(a,'create',{minutes:5,goal:'مراجعة سريعة'}),{ok:true});
  assert.equal((await shortRoom).minutes,5);
  assert.deepEqual(await command(a,'leaveLobby'),{ok:true});
  async function begin() {
    const created = waitFor(a,'room',r=>r.phase==='lobby' && r.members.length===1);
    assert.deepEqual(await command(a,'create',{minutes:25,goal:'مراجعة الفصل'}),{ok:true});
    const {id,code} = await created;
    assert.match(code,/^[A-F0-9]{8}$/);
    assert.deepEqual(await command(a,'ready'),{ok:true});
    assert.deepEqual(await command(b,'join',{code:id,goal:'كتابة التقرير'}),{ok:true});
    assert.ok((await command(c,'join',{code:id,goal:'القراءة'})).error);
    const activeA = waitFor(a,'room',r=>r.phase==='active');
    const activeB = waitFor(b,'room',r=>r.phase==='active');
    assert.deepEqual(await command(b,'ready'),{ok:true});
    const [first,second] = await Promise.all([activeA,activeB]);
    assert.equal(first.endAt,second.endAt);
    assert.equal(first.endAt-first.startsAt,25*60000);
    return first;
  }
  const first = await begin();
  const successA = waitFor(a,'profile',r=>r.completed===1);
  const successB = waitFor(b,'profile',r=>r.completed===1);
  offset += first.endAt-clock.now()+1;
  assert.equal((await successA).points,45);
  assert.equal((await successB).streak,1);

  const purchase = waitFor(a,'profile',r=>r.inventory.coffee===1);
  assert.deepEqual(await command(a,'buy',{item:'coffee'}),{ok:true});
  assert.equal((await purchase).points,5);

  const second = await begin();
  offset += second.startsAt-clock.now()+1;
  const gift = once(b,'signal');
  const giftMomentA = once(a,'giftMoment');
  const giftMomentB = once(b,'giftMoment');
  assert.deepEqual(await command(a,'signal',{item:'coffee'}),{ok:true});
  assert.deepEqual(await gift,['coffee']);
  assert.deepEqual(await giftMomentA,[{item:'coffee',from:'أحمد',to:'ريم'}]);
  assert.deepEqual(await giftMomentB,[{item:'coffee',from:'أحمد',to:'ريم'}]);
  assert.deepEqual(await command(a,'presence',{hidden:true}),{ok:true});
  const penalty = waitFor(a,'profile',r=>r.left===1);
  const compensation = waitFor(b,'profile',r=>r.points===70);
  offset += 16000;
  assert.deepEqual(await command(a,'withdraw'),{ok:true});
  assert.equal((await penalty).points,0);
  assert.equal((await compensation).history[0].reward,25);
});
