# Project Nexus

The all-in-one social platform for gamers. *(Working name, pending brand and trademark checks.)*

Nexus brings together three experiences: **Connect** (friends, messaging, communities), **Discover** (clips, creators, news) and **Compete** (teams, LFG, tournaments). This repository holds the desktop-first web app, starting with the Connect foundation.

## What works today

**Accounts and profiles**
- Sign up and sign in with username and password (scrypt hashes, httpOnly session cookies, login throttling)
- Pick your games during sign-up
- Profile with display name, bio, accent colour, "now playing", favourite games and a "looking for teammates" flag
- Status: online, idle, do not disturb, or invisible (appear offline to everyone)

**Friends and safety**
- Send, accept, decline and cancel friend requests; remove friends
- Live presence for friends and fellow community members
- Block users (ends the friendship, stops DMs and friend requests, collapses their messages)
- Report users

**Messaging**
- One-to-one DMs and group chats (up to 10 people) with friends
- Real-time delivery over WebSockets
- Replies, reactions, editing, deleting, pinned messages, typing indicators
- @mention highlighting, clickable links, unread markers, history paging

**Communities**
- Create a community (comes with announcements, general, looking-for-group and clips channels)
- Join with an invite link or from the Discover directory
- Text channels and announcement channels (only admins post)
- Roles: owner, admin, member. Admins manage channels, invites and members, and can delete messages
- Community name, game, description and accent colour

**Navigation**
- Home, Discover, Feed, News, Communities, Messages, Tournaments and Notifications
- Feed, News, Tournaments and Notifications are placeholders describing what is coming

Every permission is enforced on the server. Private channels answer 404 to non-members so their ids cannot be probed.

## Stack

| Part | Tech |
| --- | --- |
| Client | React 19, React Router, Vite, plain CSS with design tokens |
| Server | Node.js 22 (runs TypeScript directly), Express 5, Socket.IO |
| Database | SQLite through Node's built-in `node:sqlite` (no native modules) |

## Getting started

Needs **Node.js 22.18 or newer**.

```bash
npm install
npm run dev
```

Open http://localhost:5173. The API runs on port 3001 and Vite proxies `/api` and `/socket.io` to it. To try messaging, register two accounts in two browser profiles (or one normal and one private window).

### Other commands

```bash
npm test           # server API and realtime tests
npm run typecheck  # type-check server and client
npm run build      # build the client into client/dist
npm start          # serve the API and the built client on port 3001
```

Environment variables for the server: `PORT` (default 3001), `DATABASE_PATH` (default `server/nexus.db`), and `NODE_ENV=production` to mark cookies `Secure`.

## Layout

```
server/
  src/
    app.ts           Express app, routes and Socket.IO wiring
    db.ts            SQLite schema
    auth.ts          Password hashing and sessions
    access.ts        Authorization rules for channels, messages and communities
    realtime.ts      Socket.IO rooms, presence and typing
    serialize.ts     API response shapes
    routes/          auth, users and friends, communities and channels, messages and DMs
  test/              node:test suite
client/
  src/
    lib/             API client, socket, app state, types
    components/      Shell, ChatView, ProfileModal and shared UI
    pages/           Home, Messages, Communities, Discover, Settings, placeholders
```

## Next up

- Attachments and message search
- Notifications and per-community notification settings
- Voice rooms, calls and screen sharing (WebRTC)
- Forums, events and custom roles and permissions
- Discover feed with clips and permitted video embeds
- News aggregation, teammate search and tournaments
