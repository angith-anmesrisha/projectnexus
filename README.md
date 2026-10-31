# Project Nexus

The all-in-one social platform for gamers. *(Working name, pending brand and trademark checks.)*

Nexus brings together three experiences: **Connect** (friends, messaging, communities), **Discover** (clips, creators, news) and **Compete** (teams, LFG, tournaments). This repository holds the desktop-first web app, starting with the Connect foundation.

## What works today

**Landing page and sign-up**
- Animated landing page (aurora wallpaper, parallax preview cards, rotating headline, live theme carousel, sticker marquee)
- Three-step sign-up: account, the games you play, and a theme that applies live before you even land in the app

**Accounts and profiles**
- Sign up and sign in with username and password (scrypt hashes, httpOnly session cookies, login throttling)
- Pick your games during sign-up
- Profile with avatar and banner uploads, display name, bio, name colour, "now playing", favourite games and a "looking for teammates" flag
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
- Emoji picker (full Unicode set, search, skin tones, recents), `:shortcode:` autocomplete and jumbo emoji-only messages
- GIF picker with saved GIFs and GIF upload; live GIPHY or Tenor search when the server has an API key
- 16 built-in Nexus stickers, plus your own custom stickers made from any image
- Image, video and file attachments (drag and drop, paste, up to 10 MB each) with a lightbox
- Markdown: bold, italic, underline, strike, code blocks, quotes, spoilers
- Per-chat search, pinned messages panel, member panel, day dividers and jump to latest
- Ctrl+K quick switcher for friends, chats, communities and channels

**Inbox and search**
- Inbox for mentions, replies, friend requests and events, with a live badge, toasts and filters
- `@everyone` mentions for roles that are allowed to use them
- Ctrl+F global search across every chat and community you're in, with from, has-link/image/GIF/file/sticker and community filters, jumping straight to the message

**Forums, events and roles**
- Forum channels: posts with titles, previews, images and their own reply threads, sorted by activity
- Community events with date, length, location, Going/Interested RSVPs, live and countdown badges, and an upcoming list on Home
- Custom roles with colours, separate member list groups, ordering and nine permissions (edit community, channels, roles, moderate, kick, invite, events, @everyone, announcements). Nobody can grant a permission they don't have

**Customisation Studio** (Ctrl+,)
- Nine themes, plus full control over accent colours, background, panels, text, light or dark mode
- Wallpapers (aurora, neon grid, mesh, solid or your own image), dimming, panel opacity and glass blur
- Layout: dock position, density, corner radius, chat width, animation level
- Typography: nine fonts and text scale
- Chat style: bubbles, flat or cards
- 14 plugins you can switch on or off (markdown, spoilers, big emoji, focus mode, streamer mode, 24h clock, sounds, confetti and more)
- Custom CSS editor with live apply, snippets and a list of variables and classes
- Theme gallery: publish your look, install other people's themes
- Import, export and reset; everything syncs to your account across devices

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
| Client | React 19, React Router, Vite, lucide icons, plain CSS driven by theme variables |
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

Environment variables for the server: `PORT` (default 3001), `DATABASE_PATH` (default `server/nexus.db`), `UPLOAD_DIR` (default `server/uploads`), `GIPHY_API_KEY` or `TENOR_API_KEY` to turn on live GIF search, and `NODE_ENV=production` to mark cookies `Secure`.

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

- Per-community notification settings
- Voice rooms, calls and screen sharing (WebRTC)
- Discover feed with clips and permitted video embeds
- News aggregation, teammate search and tournaments
