import assert from 'node:assert/strict';
import test from 'node:test';
import { readRoomInvite,readReferralInvite,roomInviteUrl,telegramInviteUrl } from '../public/invite.js';

const code = 'a'.repeat(32);

test('creates a direct Main Mini App invite and supports an optional named app', () => {
  assert.equal(roomInviteUrl({bot:' @MethaqTestBot ',code}), 'https://t.me/MethaqTestBot?startapp='+code);
  assert.equal(roomInviteUrl({bot:'MethaqTestBot',shortName:'focus',code}), 'https://t.me/MethaqTestBot/focus?startapp='+code);
  assert.equal(roomInviteUrl({bot:'https://t.me/MethaqTestBot',code}), null);
  assert.equal(roomInviteUrl({code,guestOrigin:'http://localhost:3000'}), 'http://localhost:3000/?room='+code);
});

test('reads Telegram room code from init data, launch parameters, or local invite', () => {
  assert.equal(readRoomInvite({startParam:code,hash:'',search:''}),code);
  assert.equal(readRoomInvite({hash:'#tgWebAppVersion=8.0&tgWebAppStartParam='+code,search:''}),code);
  assert.equal(readRoomInvite({hash:'',search:'?tgWebAppStartParam='+code}),code);
  assert.equal(readRoomInvite({hash:'',search:'?room='+code}),code);
  assert.equal(readRoomInvite({startParam:'bad',hash:'',search:''}),undefined);
});

test('keeps referral launch codes separate from room invitations', () => {
  const code = 'REF-01A2B3C4D5';
  const launch = {hash:'#tgWebAppStartParam='+code,search:''};
  assert.equal(readReferralInvite(launch),code);
  assert.equal(readRoomInvite(launch),undefined);
  assert.equal(telegramInviteUrl({bot:'MethaqTestBot',code}),'https://t.me/MethaqTestBot?startapp='+code);
});
