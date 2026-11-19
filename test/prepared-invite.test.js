import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { once } from 'node:events';
import test from 'node:test';
import { io } from 'socket.io-client';
import { Telegram } from 'telegraf';

test('prepares a Telegram message whose join button opens the waiting room', {timeout:8000}, async (t) => {
  process.env.BOT_TOKEN = 'fixture:token';
  process.env.BOT_USERNAME = 'MethaqTestBot';
  process.env.APP_SHORT_NAME = '';
  process.env.DATABASE_PATH = ':memory:';
  process.env.PORT = '0';
  process.env.RUN_BOT = '0';
  process.env.ADMIN_TELEGRAM_IDS = '"١٠١، ٩٩٩"';
  const api = t.mock.method(Telegram.prototype,'callApi',async () => ({id:'prepared-test-message'}));
  const {http} = await import('../server.js');
  if (!http.listening) await once(http,'listening');
  const sockets = [];
  t.after(() => { sockets.forEach(socket=>socket.disconnect()); http.close(); });

  async function connect(id, event='hello') {
    const params = new URLSearchParams({
      auth_date:String(Math.floor(Date.now()/1000)),
      user:JSON.stringify({id,first_name:'طالب',username:'student_'+id})
    });
    const key = createHmac('sha256','WebAppData').update(process.env.BOT_TOKEN).digest();
    params.set('hash',createHmac('sha256',key).update([...params].map(([k,v])=>k+'='+v).join('\n')).digest('hex'));
    const socket = io('http://localhost:'+http.address().port,{auth:{initData:params.toString()}});
    sockets.push(socket);
    await once(socket,event);
    return socket;
  }
  const host = await connect(101);
  const recipient = await connect(102);
  const command = (socket,event,payload={}) => socket.timeout(2000).emitWithAck(event,payload);
  assert.ok((await command(recipient,'prepareInvite')).error);
  assert.ok((await command(recipient,'adminList')).error);
  const hostProfile = once(host,'profile');
  await command(host,'refreshProfile');
  assert.equal((await hostProfile)[0].adminAccess,'enabled');
  const guestProfile = once(recipient,'profile');
  await command(recipient,'refreshProfile');
  assert.equal((await guestProfile)[0].adminAccess,'different-account');
  const students = await command(host,'adminList',{search:'@student_102'});
  assert.equal(students.students[0].id,'102');
  const proProfile = once(recipient,'profile');
  assert.deepEqual(await command(host,'adminGrant',{plan:'pro',student:'102'}),{ok:true});
  assert.equal((await proProfile)[0].plan.tier,'pro');
  const {code:promo} = await command(host,'adminCode',{plan:'special'});
  const specialProfile = once(recipient,'profile');
  assert.deepEqual(await command(recipient,'redeemCode',{code:promo.toLowerCase()}),{ok:true});
  assert.equal((await specialProfile)[0].plan.tier,'special');
  assert.ok((await command(host,'redeemCode',{code:promo})).error);
  const created = once(host,'room');
  assert.deepEqual(await command(host,'create',{minutes:25,goal:'مراجعة الدرس'}),{ok:true});
  const [room] = await created;
  const direct = once(recipient,'directInvite');
  assert.deepEqual(await command(host,'directInvite',{handle:'@student_102'}),{ok:true});
  assert.equal((await direct)[0].code,room.id);
  assert.deepEqual(await command(host,'prepareInvite'),{messageId:'prepared-test-message'});
  assert.equal(api.mock.callCount(),1);
  const [method,payload] = api.mock.calls[0].arguments;
  assert.equal(method,'savePreparedInlineMessage');
  assert.equal(payload.user_id,101);
  assert.equal(payload.allow_user_chats,true);
  const [[button]] = payload.result.reply_markup.inline_keyboard;
  assert.equal(button.text,'انضمام');
  assert.equal(button.url,'https://t.me/MethaqTestBot?startapp='+room.id);

  const joined = once(recipient,'room');
  assert.deepEqual(await command(recipient,'join',{code:room.code.toLowerCase(),goal:'القراءة'}),{ok:true});
  assert.equal((await joined)[0].members.length,2);
  assert.ok((await command(host,'prepareInvite')).error);
  const banned = once(recipient,'banned');
  assert.deepEqual(await command(host,'adminBan',{student:'102',banned:true}),{ok:true});
  assert.match((await banned)[0],/حُظر/);
  const rejected = await connect(102,'connect_error');
  assert.equal(rejected.connected,false);
  assert.deepEqual(await command(host,'adminBan',{student:'102',banned:false}),{ok:true});
  assert.equal((await connect(102)).connected,true);
});
