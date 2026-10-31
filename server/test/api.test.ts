import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { io as connect, type Socket } from 'socket.io-client';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNexus } from '../src/app.ts';

let nexus: ReturnType<typeof createNexus>;
let base: string;

before(async () => {
  nexus = createNexus({ dbPath: ':memory:', uploadDir: mkdtempSync(join(tmpdir(), 'nexus-uploads-')) });
  await new Promise<void>((resolve) => nexus.server.listen(0, resolve));
  base = `http://localhost:${(nexus.server.address() as AddressInfo).port}`;
});

after(async () => {
  await nexus.close();
});

/** A signed-in test user with its own session cookie. */
class Client {
  cookie = '';
  id = '';
  username: string;
  constructor(username: string) {
    this.username = username;
  }

  async upload(bytes: Buffer, name: string) {
    const res = await fetch(`${base}/api/uploads?name=${encodeURIComponent(name)}&w=10&h=10`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream', cookie: this.cookie },
      body: bytes,
    });
    return { status: res.status, body: (await res.json()) as any };
  }

  async call(method: string, path: string, body?: unknown) {
    const res = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json', cookie: this.cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) this.cookie = setCookie.split(';')[0];
    return { status: res.status, body: (await res.json()) as any };
  }

  async register() {
    const r = await this.call('POST', '/api/auth/register', { username: this.username, password: 'hunter2hunter2' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    this.id = r.body.user.id;
    return this;
  }

  socket(): Promise<Socket> {
    const s = connect(base, { extraHeaders: { cookie: this.cookie }, transports: ['websocket'] });
    return new Promise((resolve, reject) => {
      s.on('connect', () => resolve(s));
      s.on('connect_error', reject);
    });
  }
}

const once = <T = any>(s: Socket, event: string) =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), 2000);
    s.once(event, (p: T) => {
      clearTimeout(timer);
      resolve(p);
    });
  });

async function befriend(a: Client, b: Client) {
  assert.equal((await a.call('POST', '/api/friends/requests', { username: b.username })).status, 201);
  assert.equal((await b.call('POST', `/api/friends/requests/${a.id}/accept`)).status, 200);
}

describe('auth', () => {
  test('register, me, logout, login', async () => {
    const c = await new Client('ace').register();
    assert.equal((await c.call('GET', '/api/auth/me')).body.user.username, 'ace');
    await c.call('POST', '/api/auth/logout');
    assert.equal((await c.call('GET', '/api/auth/me')).status, 401);
    const wrong = await c.call('POST', '/api/auth/login', { username: 'ace', password: 'nope-nope-nope' });
    assert.equal(wrong.status, 401);
    const ok = await c.call('POST', '/api/auth/login', { username: 'ACE', password: 'hunter2hunter2' });
    assert.equal(ok.status, 200);
    assert.equal((await c.call('GET', '/api/auth/me')).status, 200);
  });

  test('rejects duplicate usernames and short passwords', async () => {
    await new Client('dupe').register();
    const again = await new Client('Dupe').call('POST', '/api/auth/register', { username: 'Dupe', password: 'hunter2hunter2' });
    assert.equal(again.status, 409);
    const short = await new Client('shorty').call('POST', '/api/auth/register', { username: 'shorty', password: 'abc' });
    assert.equal(short.status, 400);
  });

  test('profile updates are validated', async () => {
    const c = await new Client('profiler').register();
    const r = await c.call('PATCH', '/api/users/me', { nowPlaying: 'Valorant', lfg: true, games: ['Valorant', 'Valorant', 'Minecraft'] });
    assert.equal(r.body.user.nowPlaying, 'Valorant');
    assert.equal(r.body.user.lfg, true);
    assert.deepEqual(r.body.user.games, ['Valorant', 'Minecraft']);
    assert.equal((await c.call('PATCH', '/api/users/me', { status: 'sleeping' })).status, 400);
  });
});

describe('friends and DMs', () => {
  test('friend request flow and DM creation', async () => {
    const a = await new Client('alpha').register();
    const b = await new Client('bravo').register();

    // No DMs with strangers.
    assert.equal((await a.call('POST', '/api/dms', { userIds: [b.id] })).status, 403);

    await a.call('POST', '/api/friends/requests', { username: 'bravo' });
    assert.equal((await b.call('GET', '/api/friends')).body.incoming[0].id, a.id);
    await b.call('POST', `/api/friends/requests/${a.id}/accept`);
    assert.equal((await a.call('GET', '/api/friends')).body.friends[0].id, b.id);

    const dm = await a.call('POST', '/api/dms', { userIds: [b.id] });
    assert.equal(dm.status, 201);
    // Opening it again reuses the same conversation.
    const again = await b.call('POST', '/api/dms', { userIds: [a.id] });
    assert.equal(again.body.conversation.id, dm.body.conversation.id);

    const sent = await a.call('POST', `/api/channels/${dm.body.conversation.id}/messages`, { content: 'gg' });
    assert.equal(sent.status, 201);
    const list = await b.call('GET', `/api/channels/${dm.body.conversation.id}/messages`);
    assert.equal(list.body.messages[0].content, 'gg');

    // Outsiders cannot read it, and get a 404 rather than a 403.
    const c = await new Client('charlie').register();
    assert.equal((await c.call('GET', `/api/channels/${dm.body.conversation.id}/messages`)).status, 404);
  });

  test('blocking ends the friendship and stops DMs', async () => {
    const a = await new Client('blocker').register();
    const b = await new Client('blockee').register();
    await befriend(a, b);
    const dm = (await a.call('POST', '/api/dms', { userIds: [b.id] })).body.conversation;

    await a.call('POST', `/api/blocks/${b.id}`);
    assert.equal((await a.call('GET', '/api/friends')).body.friends.length, 0);
    assert.equal((await b.call('POST', `/api/channels/${dm.id}/messages`, { content: 'hi?' })).status, 403);
    assert.equal((await b.call('POST', '/api/friends/requests', { username: 'blocker' })).status, 404);
    assert.equal((await b.call('GET', '/api/users/blocker')).status, 404);
  });
});

describe('communities', () => {
  test('create, join by invite, post, and permissions', async () => {
    const owner = await new Client('owner1').register();
    const member = await new Client('member1').register();
    const outsider = await new Client('outsider1').register();

    const created = await owner.call('POST', '/api/communities', { name: 'Valorant Scrims', game: 'Valorant' });
    assert.equal(created.status, 201);
    const community = created.body.community;
    const announcements = community.channels.find((c: any) => c.kind === 'announcement');
    const general = community.channels.find((c: any) => c.name === 'general');
    assert.ok(community.inviteCode);

    assert.equal((await outsider.call('GET', `/api/channels/${general.id}/messages`)).status, 404);
    assert.equal((await outsider.call('GET', `/api/communities/${community.id}`)).status, 404);

    const joined = await member.call('POST', '/api/communities/join', { inviteCode: `https://nexus.gg/invite/${community.inviteCode}` });
    assert.equal(joined.status, 200);
    assert.equal(joined.body.community.inviteCode, undefined, 'members do not see the invite code');

    assert.equal((await member.call('POST', `/api/channels/${general.id}/messages`, { content: 'hello' })).status, 201);
    assert.equal((await member.call('POST', `/api/channels/${announcements.id}/messages`, { content: 'hi' })).status, 403);
    assert.equal((await owner.call('POST', `/api/channels/${announcements.id}/messages`, { content: 'Scrims at 8' })).status, 201);

    // Members cannot create channels; admins can.
    assert.equal((await member.call('POST', `/api/communities/${community.id}/channels`, { name: 'strats' })).status, 403);
    await owner.call('PATCH', `/api/communities/${community.id}/members/${member.id}`, { role: 'admin' });
    const ch = await member.call('POST', `/api/communities/${community.id}/channels`, { name: 'Strats & Lineups' });
    assert.equal(ch.status, 201);
    assert.equal(ch.body.channel.name, 'strats-lineups');
  });

  test('message editing, deleting, reactions, replies and pins', async () => {
    const owner = await new Client('owner2').register();
    const member = await new Client('member2').register();
    const community = (await owner.call('POST', '/api/communities', { name: 'Builders' })).body.community;
    await member.call('POST', `/api/communities/${community.id}/join`);
    const general = community.channels.find((c: any) => c.name === 'general');

    const m1 = (await member.call('POST', `/api/channels/${general.id}/messages`, { content: 'first' })).body.message;
    const reply = await owner.call('POST', `/api/channels/${general.id}/messages`, { content: 'nice', replyToId: m1.id });
    assert.equal(reply.body.message.replyTo.id, m1.id);

    assert.equal((await owner.call('PATCH', `/api/messages/${m1.id}`, { content: 'hacked' })).status, 403);
    const edited = await member.call('PATCH', `/api/messages/${m1.id}`, { content: 'first!' });
    assert.ok(edited.body.message.editedAt);

    const reacted = await owner.call('POST', `/api/messages/${m1.id}/reactions`, { emoji: '🔥' });
    assert.deepEqual(reacted.body.message.reactions, [{ emoji: '🔥', count: 1, me: true }]);
    assert.equal((await owner.call('POST', `/api/messages/${m1.id}/reactions`, { emoji: 'not an emoji' })).status, 400);

    assert.equal((await member.call('POST', `/api/messages/${m1.id}/pin`)).status, 403);
    assert.equal((await owner.call('POST', `/api/messages/${m1.id}/pin`)).status, 200);
    assert.equal((await member.call('GET', `/api/channels/${general.id}/pins`)).body.messages.length, 1);

    // Moderators can delete other people's messages.
    assert.equal((await owner.call('DELETE', `/api/messages/${m1.id}`)).status, 200);
    const list = (await member.call('GET', `/api/channels/${general.id}/messages`)).body.messages;
    assert.equal(list.length, 1);
    assert.equal(list[0].replyTo.content, null);
  });

  test('kicked members lose access', async () => {
    const owner = await new Client('owner3').register();
    const member = await new Client('member3').register();
    const community = (await owner.call('POST', '/api/communities', { name: 'Kickers' })).body.community;
    await member.call('POST', `/api/communities/${community.id}/join`);
    await owner.call('DELETE', `/api/communities/${community.id}/members/${member.id}`);
    const general = community.channels.find((c: any) => c.name === 'general');
    assert.equal((await member.call('GET', `/api/channels/${general.id}/messages`)).status, 404);
  });
});

describe('media, stickers and appearance', () => {
  // Smallest valid GIF header plus padding is enough for type sniffing.
  const gif = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(32)]);

  test('uploads are sniffed and can be attached by their owner only', async () => {
    const a = await new Client('uploader').register();
    const b = await new Client('thief').register();
    const community = (await a.call('POST', '/api/communities', { name: 'Media' })).body.community;
    await b.call('POST', `/api/communities/${community.id}/join`);
    const general = community.channels.find((c: any) => c.name === 'general');

    const up = await a.upload(gif, 'party.gif');
    assert.equal(up.status, 201);
    assert.equal(up.body.attachment.kind, 'gif');
    const fetched = await fetch(base + up.body.attachment.url);
    assert.equal(fetched.headers.get('content-type'), 'image/gif');

    // A script disguised as an image is stored as an opaque download.
    const evil = await a.upload(Buffer.from('<script>alert(1)</script>'), 'cat.png');
    assert.equal(evil.body.attachment.kind, 'file');
    assert.match(evil.body.attachment.url, /\.bin$/);

    const sent = await a.call('POST', `/api/channels/${general.id}/messages`, { attachments: [{ uploadId: up.body.id }] });
    assert.equal(sent.status, 201);
    assert.equal(sent.body.message.attachments[0].kind, 'gif');
    assert.equal((await b.call('POST', `/api/channels/${general.id}/messages`, { attachments: [{ uploadId: up.body.id }] })).status, 400);

    // GIFs from search providers are fine; arbitrary hosts are not.
    assert.equal((await a.call('POST', `/api/channels/${general.id}/messages`, { attachments: [{ gifUrl: 'https://media.giphy.com/media/abc/giphy.gif' }] })).status, 201);
    assert.equal((await a.call('POST', `/api/channels/${general.id}/messages`, { attachments: [{ gifUrl: 'https://evil.example/track.gif' }] })).status, 400);
    assert.equal((await a.call('POST', `/api/channels/${general.id}/messages`, {})).status, 400);
  });

  test('stickers: built-in and personal', async () => {
    const a = await new Client('stickerer').register();
    const community = (await a.call('POST', '/api/communities', { name: 'Stickers' })).body.community;
    const general = community.channels.find((c: any) => c.name === 'general');
    const builtin = await a.call('POST', `/api/channels/${general.id}/messages`, { sticker: { id: 'nexus:gg' } });
    assert.equal(builtin.body.message.sticker.id, 'nexus:gg');
    assert.equal((await a.call('POST', `/api/channels/${general.id}/messages`, { sticker: { id: 'nexus:nope' } })).status, 400);

    const up = await a.upload(gif, 'me.gif');
    const sticker = (await a.call('POST', '/api/stickers', { name: 'Me', uploadId: up.body.id })).body.sticker;
    const custom = await a.call('POST', `/api/channels/${general.id}/messages`, { sticker: { id: `custom:${sticker.id}` } });
    assert.equal(custom.body.message.sticker.url, sticker.url);
  });

  test('appearance prefs sync and the theme gallery', async () => {
    const a = await new Client('themer').register();
    const b = await new Client('installer').register();
    await a.call('PUT', '/api/users/me/prefs', { prefs: { theme: 'synthwave', customCss: '.x{}' } });
    assert.deepEqual((await a.call('GET', '/api/users/me/prefs')).body.prefs, { theme: 'synthwave', customCss: '.x{}' });
    assert.equal((await a.call('PUT', '/api/users/me/prefs', { prefs: { customCss: 'x'.repeat(70_000) } })).status, 400);

    const theme = (await a.call('POST', '/api/themes', { name: 'Neon Dusk', data: { theme: 'synthwave' } })).body.theme;
    assert.equal((await b.call('POST', `/api/themes/${theme.id}/install`)).body.theme.installs, 1);
    assert.equal((await b.call('GET', '/api/themes')).body.themes[0].name, 'Neon Dusk');
    assert.equal((await b.call('DELETE', `/api/themes/${theme.id}`)).status, 403);
  });
});

describe('realtime', () => {
  test('messages, typing and presence reach the right people', async () => {
    const a = await new Client('rt_a').register();
    const b = await new Client('rt_b').register();
    const outsider = await new Client('rt_out').register();
    await befriend(a, b);
    const dm = (await a.call('POST', '/api/dms', { userIds: [b.id] })).body.conversation;

    const sb = await b.socket();
    const so = await outsider.socket();
    let outsiderSaw = false;
    so.on('message:new', () => (outsiderSaw = true));

    // B sees A come online.
    const presence = once(sb, 'user:update');
    const sa = await a.socket();
    assert.equal((await presence).presence, 'online');

    const incoming = once(sb, 'message:new');
    await a.call('POST', `/api/channels/${dm.id}/messages`, { content: 'queue up?' });
    assert.equal((await incoming).content, 'queue up?');

    const typing = once(sb, 'typing');
    sa.emit('typing', { channelId: dm.id });
    assert.equal((await typing).userId, a.id);

    // Outsiders cannot spoof typing into a channel they cannot read.
    so.emit('typing', { channelId: dm.id });
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(outsiderSaw, false);

    // A new community channel is delivered live to existing members.
    const community = (await a.call('POST', '/api/communities', { name: 'Live' })).body.community;
    await b.call('POST', `/api/communities/${community.id}/join`);
    const ch = (await a.call('POST', `/api/communities/${community.id}/channels`, { name: 'fresh' })).body.channel;
    const live = once(sb, 'message:new');
    await a.call('POST', `/api/channels/${ch.id}/messages`, { content: 'first in fresh' });
    assert.equal((await live).channelId, ch.id);

    sa.close();
    sb.close();
    so.close();
  });

  test('sockets without a session are rejected', async () => {
    await assert.rejects(new Client('nobody').socket());
  });
});
