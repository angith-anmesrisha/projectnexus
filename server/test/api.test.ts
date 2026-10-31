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

describe('phase 2: notifications, search, roles, forums, events', () => {
  test('mentions, replies and friend requests land in the inbox, live', async () => {
    const a = await new Client('notif_a').register();
    const b = await new Client('notif_b').register();
    const sb = await b.socket();
    const req = once(sb, 'notification:new');
    await a.call('POST', '/api/friends/requests', { username: 'notif_b' });
    const pushed = await req;
    assert.equal(pushed.notification.kind, 'friend_request');
    assert.equal(pushed.unread, 1);

    const community = (await a.call('POST', '/api/communities', { name: 'Pings' })).body.community;
    await b.call('POST', `/api/communities/${community.id}/join`);
    const general = community.channels.find((c: any) => c.name === 'general');
    const mention = once(sb, 'notification:new');
    const msg = (await a.call('POST', `/api/channels/${general.id}/messages`, { content: 'hey @notif_b, scrim?' })).body.message;
    assert.equal((await mention).notification.kind, 'mention');

    // Replying to your own message never notifies you; replying to theirs does.
    const own = (await b.call('POST', `/api/channels/${general.id}/messages`, { content: 'sure' })).body.message;
    await a.call('POST', `/api/channels/${general.id}/messages`, { content: 'nice', replyToId: own.id });
    await b.call('POST', `/api/channels/${general.id}/messages`, { content: 'self reply', replyToId: own.id });

    // @everyone needs the permission: B can't, A (owner) can.
    await b.call('POST', `/api/channels/${general.id}/messages`, { content: '@everyone look' });
    const inboxA = (await a.call('GET', '/api/notifications')).body;
    assert.equal(inboxA.notifications.filter((n: any) => n.kind === 'mention').length, 0);

    const inbox = (await b.call('GET', '/api/notifications')).body;
    assert.deepEqual(
      inbox.notifications.map((n: any) => n.kind),
      ['reply', 'mention', 'friend_request'],
    );
    assert.equal(inbox.notifications[1].messageId, msg.id);
    assert.equal(inbox.unread, 3);
    assert.equal((await b.call('POST', '/api/notifications/read', { ids: [inbox.notifications[0].id] })).body.unread, 2);
    assert.equal((await b.call('POST', '/api/notifications/read', {})).body.unread, 0);
    sb.close();
  });

  test('search only covers channels you can read', async () => {
    const a = await new Client('search_a').register();
    const b = await new Client('search_b').register();
    const c = await new Client('search_c').register();
    const community = (await a.call('POST', '/api/communities', { name: 'Searchers' })).body.community;
    await b.call('POST', `/api/communities/${community.id}/join`);
    const general = community.channels.find((ch: any) => ch.name === 'general');
    await a.call('POST', `/api/channels/${general.id}/messages`, { content: 'the secret rotation is B long' });
    await b.call('POST', `/api/channels/${general.id}/messages`, { content: 'rotation sounds good https://example.com' });

    const r = (await b.call('GET', '/api/search?q=rotation')).body;
    assert.equal(r.messages.length, 2);
    assert.equal(r.places[general.id].communityName, 'Searchers');
    assert.equal((await b.call('GET', '/api/search?q=rotation&from=search_a')).body.messages.length, 1);
    assert.equal((await b.call('GET', '/api/search?has=link')).body.messages.length, 1);
    assert.equal((await b.call('GET', '/api/search?q=secret%20long')).body.messages.length, 1);
    assert.equal((await c.call('GET', '/api/search?q=rotation')).body.messages.length, 0);
    assert.equal((await c.call('GET', '/api/search')).status, 400);
  });

  test('custom roles grant permissions without escalation', async () => {
    const owner = await new Client('role_owner').register();
    const mod = await new Client('role_mod').register();
    const pleb = await new Client('role_pleb').register();
    const community = (await owner.call('POST', '/api/communities', { name: 'Ranked' })).body.community;
    await mod.call('POST', `/api/communities/${community.id}/join`);
    await pleb.call('POST', `/api/communities/${community.id}/join`);

    // Members can't make channels until a role lets them.
    assert.equal((await mod.call('POST', `/api/communities/${community.id}/channels`, { name: 'nope' })).status, 403);
    const role = (
      await owner.call('POST', `/api/communities/${community.id}/roles`, {
        name: 'Coach',
        color: '#ff8800',
        permissions: 2 | 4 | 8, // channels, roles, messages
        hoist: true,
      })
    ).body.role;
    assert.equal(role.name, 'Coach');
    const assigned = await owner.call('PUT', `/api/communities/${community.id}/members/${mod.id}/roles`, { roleIds: [role.id] });
    assert.deepEqual(assigned.body.community.members.find((m: any) => m.id === mod.id).roleIds, [role.id]);
    assert.equal((await mod.call('POST', `/api/communities/${community.id}/channels`, { name: 'vods' })).status, 201);

    // A coach can't hand out kick rights they don't have, or edit up their own role.
    const kicky = await mod.call('POST', `/api/communities/${community.id}/roles`, { name: 'Bouncer', permissions: 16 });
    assert.equal(kicky.status, 403);
    assert.equal((await mod.call('PATCH', `/api/roles/${role.id}`, { permissions: 2 | 4 | 8 | 16 })).status, 403);
    assert.equal((await mod.call('DELETE', `/api/communities/${community.id}/members/${pleb.id}`)).status, 403);

    // Message moderation follows the role.
    const general = community.channels.find((c: any) => c.name === 'general');
    const m = (await pleb.call('POST', `/api/channels/${general.id}/messages`, { content: 'spam' })).body.message;
    assert.equal((await mod.call('DELETE', `/api/messages/${m.id}`)).status, 200);

    // Deleting the role removes the access again.
    assert.equal((await owner.call('DELETE', `/api/roles/${role.id}`)).status, 200);
    assert.equal((await mod.call('POST', `/api/communities/${community.id}/channels`, { name: 'again' })).status, 403);
  });

  test('forums hold posts with their own replies', async () => {
    const a = await new Client('forum_a').register();
    const b = await new Client('forum_b').register();
    const outsider = await new Client('forum_x').register();
    const community = (await a.call('POST', '/api/communities', { name: 'Guides' })).body.community;
    await b.call('POST', `/api/communities/${community.id}/join`);
    const forum = (await a.call('POST', `/api/communities/${community.id}/channels`, { name: 'guides', kind: 'forum' })).body.channel;
    assert.equal(forum.kind, 'forum');
    assert.equal((await a.call('POST', `/api/channels/${forum.id}/messages`, { content: 'hi' })).status, 400);

    const sb = await b.socket();
    const live = once(sb, 'thread:update');
    const post = (await a.call('POST', `/api/channels/${forum.id}/threads`, { title: 'Smoke lineups', content: 'Here are mine' })).body.thread;
    assert.equal((await live).thread.id, post.id);
    assert.equal(post.title, 'Smoke lineups');

    assert.equal((await b.call('POST', `/api/channels/${post.id}/messages`, { content: 'saving this' })).status, 201);
    const list = (await b.call('GET', `/api/channels/${forum.id}/threads`)).body.threads;
    assert.equal(list.length, 1);
    assert.equal(list[0].replies, 1);
    assert.equal(list[0].preview, 'Here are mine');

    // Posts don't clutter the channel list, and outsiders can't read them.
    const detail = (await b.call('GET', `/api/communities/${community.id}`)).body.community;
    assert.ok(!detail.channels.some((c: any) => c.kind === 'thread'));
    assert.equal((await outsider.call('GET', `/api/channels/${post.id}/messages`)).status, 404);

    // Only the author (or a moderator) can delete a post.
    assert.equal((await b.call('DELETE', `/api/channels/${post.id}`)).status, 403);
    assert.equal((await a.call('DELETE', `/api/channels/${post.id}`)).status, 200);
    sb.close();
  });

  test('events with RSVPs', async () => {
    const a = await new Client('event_a').register();
    const b = await new Client('event_b').register();
    const community = (await a.call('POST', '/api/communities', { name: 'Cup' })).body.community;
    await b.call('POST', `/api/communities/${community.id}/join`);
    const startsAt = Date.now() + 86_400_000;
    assert.equal((await b.call('POST', `/api/communities/${community.id}/events`, { title: 'Nope', startsAt })).status, 403);
    assert.equal((await a.call('POST', `/api/communities/${community.id}/events`, { title: 'Past', startsAt: Date.now() - 86_400_000 })).status, 400);
    const ev = (
      await a.call('POST', `/api/communities/${community.id}/events`, {
        title: 'Friday Cup',
        description: '5v5 bracket',
        location: '#general',
        startsAt,
        endsAt: startsAt + 3 * 3_600_000,
      })
    ).body.event;
    assert.equal(ev.going, 1);
    assert.equal(ev.myRsvp, 'going');

    const r = (await b.call('POST', `/api/events/${ev.id}/rsvp`, { status: 'interested' })).body.event;
    assert.equal(r.interested, 1);
    assert.equal(r.myRsvp, 'interested');
    assert.equal(r.canManage, false);
    const upcoming = (await b.call('GET', '/api/events')).body.events;
    assert.equal(upcoming[0].title, 'Friday Cup');
    const inbox = (await b.call('GET', '/api/notifications')).body.notifications;
    assert.equal(inbox[0].kind, 'event');

    assert.equal((await b.call('DELETE', `/api/events/${ev.id}`)).status, 403);
    assert.equal((await a.call('DELETE', `/api/events/${ev.id}`)).status, 200);
    assert.equal((await b.call('GET', `/api/communities/${community.id}/events`)).body.events.length, 0);
  });
});

describe('phase 3: voice rooms and signalling', () => {
  const emitAck = (s: Socket, event: string, payload: unknown) =>
    new Promise<any>((resolve) => s.emit(event, payload, resolve));

  test('join, signal, update and leave a voice lounge', async () => {
    const a = await new Client('voice_a').register();
    const b = await new Client('voice_b').register();
    const outsider = await new Client('voice_x').register();
    const community = (await a.call('POST', '/api/communities', { name: 'Voicey' })).body.community;
    await b.call('POST', `/api/communities/${community.id}/join`);
    const lounge = community.channels.find((c: any) => c.kind === 'voice');
    const general = community.channels.find((c: any) => c.name === 'general');
    assert.ok(lounge, 'communities come with voice lounges');

    const sa = await a.socket();
    const sb = await b.socket();
    const so = await outsider.socket();

    assert.ok((await emitAck(sa, 'voice:join', { channelId: general.id })).error, 'text channels have no voice');
    assert.ok((await emitAck(so, 'voice:join', { channelId: lounge.id })).error, 'outsiders cannot join');

    const stateSeen = once(sb, 'voice:state');
    const joined = await emitAck(sa, 'voice:join', { channelId: lounge.id });
    assert.deepEqual(joined.participants.map((p: any) => p.userId), [a.id]);
    assert.equal((await stateSeen).participants.length, 1);
    assert.equal((await b.call('GET', '/api/voice')).body.rooms[lounge.id].length, 1);
    assert.deepEqual((await outsider.call('GET', '/api/voice')).body.rooms, {});

    const aSeesB = once(sa, 'voice:joined');
    await emitAck(sb, 'voice:join', { channelId: lounge.id });
    assert.equal((await aSeesB).userId, b.id);

    const signal = once(sa, 'voice:signal');
    sb.emit('voice:signal', { to: a.id, data: { description: { type: 'offer', sdp: 'x' } } });
    const got = await signal;
    assert.equal(got.from, b.id);
    assert.equal(got.data.description.type, 'offer');

    const muted = once(sb, 'voice:state');
    sa.emit('voice:update', { muted: true, video: true, streams: { camera: 'cam1' } });
    const st = (await muted).participants.find((p: any) => p.userId === a.id);
    assert.equal(st.muted, true);
    assert.equal(st.streams.camera, 'cam1');

    // Disconnecting leaves the room.
    const left = once(sb, 'voice:left');
    sa.close();
    assert.equal((await left).userId, a.id);
    sb.close();
    so.close();
  });

  test('DM calls ring the other person', async () => {
    const a = await new Client('call_a').register();
    const b = await new Client('call_b').register();
    await befriend(a, b);
    const dm = (await a.call('POST', '/api/dms', { userIds: [b.id] })).body.conversation;
    const sa = await a.socket();
    const sb = await b.socket();
    const ring = once(sb, 'call:ring');
    await emitAck(sa, 'voice:join', { channelId: dm.id });
    const r = await ring;
    assert.equal(r.channelId, dm.id);
    assert.equal(r.from.id, a.id);
    const end = once(sb, 'call:end');
    sa.emit('voice:leave');
    assert.equal((await end).channelId, dm.id);
    sa.close();
    sb.close();
  });
});
