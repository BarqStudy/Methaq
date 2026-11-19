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
  assert.ok((await command(a,'appearance',{mode:'dark',palette:'aurora'})).error);
  const appearance = waitFor(a,'profile',r=>r.appearance.palette==='blue');
  assert.deepEqual(await command(a,'appearance',{mode:'light',palette:'blue'}),{ok:true});
  assert.equal((await appearance).appearance.mode,'light');
  const b = await guest('ريم');
  const c = await guest('نور');
  async function begin() {
    const created = waitFor(a,'room',r=>r.phase==='lobby' && r.members.length===1);
    assert.deepEqual(await command(a,'create',{minutes:25,goal:'مراجعة الفصل'}),{ok:true});
    const {id} = await created;
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
  const microCheck = waitFor(a,'room',r=>r.members[0].checkUntil);
  offset += first.members[0].nextCheck - clock.now()+1;
  const micro = await microCheck;
  assert.ok(micro.members[0].checkUntil > clock.now());
  assert.deepEqual(await command(a,'check'),{ok:true});
  if (micro.members[1].checkUntil) assert.deepEqual(await command(b,'check'),{ok:true});
  const successA = waitFor(a,'profile',r=>r.completed===1);
  const successB = waitFor(b,'profile',r=>r.completed===1);
  offset += first.endAt-clock.now()+1;
  assert.equal((await successA).points,60);
  assert.equal((await successB).streak,1);

  const purchase = waitFor(a,'profile',r=>r.inventory.coffee===1);
  assert.deepEqual(await command(a,'buy',{item:'coffee'}),{ok:true});
  assert.equal((await purchase).points,20);

  const second = await begin();
  offset += second.startsAt-clock.now()+1;
  const gift = once(b,'signal');
  assert.deepEqual(await command(a,'signal',{item:'coffee'}),{ok:true});
  assert.deepEqual(await gift,['coffee']);
  const leaving = waitFor(a,'room',r=>r.members[0].exitAt);
  assert.deepEqual(await command(a,'presence',{hidden:true}),{ok:true});
  const state = await leaving;
  const penalty = waitFor(a,'profile',r=>r.left===1);
  const compensation = waitFor(b,'profile',r=>r.points===85);
  offset += state.members[0].exitAt-clock.now()+1;
  assert.equal((await penalty).points,0);
  assert.equal((await compensation).history[0].reward,25);
});
