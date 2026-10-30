# Pulse Chat — Real-Time Chat Workspace

Pulse Chat is a real-time messaging application designed with a mini design system, WebSocket-based bi-directional communication, JWT-based user authentication, and SQLite persistent storage.

---

## 🚀 Features

- **Real-Time Messaging**: Built on **Socket.IO** for instant communication with zero perceptible latency.
- **Persistent Storage**: All chat messages and registered accounts are saved to an embedded **SQLite** database (`node:sqlite`).
- **Authentication & Security**:
  - Secure password hashing using **bcryptjs** (10 salt rounds).
  - Stateless authentication tokens via **JSON Web Tokens (JWT)**.
  - Protected API routes and socket authentication handshake.
- **Active Member Presence**: Real-time user list showing who is online and active in the room.
- **Typing Indicators**: Displays when members are actively drafting messages.
- **Design System**: Responsive 12-column desktop and 4-column mobile layout built on semantic tokens (colors, typography, cards, buttons, avatars).

---

## 📁 Project Structure

```text
real-time-chat-apps/
├── backend/
│   ├── config/
│   │   ├── db.js             # SQLite database connection & schema initialization
│   │   └── jwt.js            # JWT signing, verification, and requireAuth middleware
│   ├── models/
│   │   ├── User.js           # User model (registration, lookup, verification)
│   │   └── Message.js        # Message model (creation, recent history)
│   ├── routes/
│   │   ├── auth.js           # /api/auth/register, /api/auth/login, /api/auth/me
│   │   └── messages.js       # /api/messages (history retrieval)
│   ├── socket/
│   │   └── index.js          # Socket.IO connection, join, chat-message, typing, disconnect
│   └── server.js             # Express app & HTTP server entry point
├── fronted/
│   ├── css/
│   │   └── design-system.css # Mini design system styles (12-col/4-col grid, typography, components)
│   ├── js/
│   │   └── auth.js           # Client-side auth helpers, session management & API bindings
│   ├── index.html            # Landing welcome page
│   ├── login.html            # Account login page
│   ├── register.html         # User registration page
│   ├── chat.html             # Real-time chat workspace interface
│   └── design-system.html    # Design system component showcase
├── .env.example              # Environment variables template
├── package.json              # NPM dependencies & scripts
└── test_chat.js              # Automated end-to-end test suite
```

---

## 🛠️ Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment (Required)
Copy `.env.example` to `.env` and configure your secret:
```bash
cp .env.example .env
```
Ensure `JWT_SECRET` is set to a unique, secure secret key in your `.env` file (e.g., generated with `openssl rand -hex 32`). Defaults to port `5000`.

### 3. Start the Server
```bash
# Normal start
npm start

# Development mode (with file watcher)
npm run dev
```

Visit the app in your browser:
- Landing Page: [http://localhost:5000](http://localhost:5000)
- Register: [http://localhost:5000/register.html](http://localhost:5000/register.html)
- Login: [http://localhost:5000/login.html](http://localhost:5000/login.html)
- Chat Room: [http://localhost:5000/chat.html](http://localhost:5000/chat.html)
- Design System: [http://localhost:5000/design-system.html](http://localhost:5000/design-system.html)

---

## 🧪 Running Tests

The test suite exercises static asset serving, auth registration/login, duplicate prevention, JWT protection, Socket.IO real-time message broadcasting, and SQLite database persistence:

```bash
npm test
```

---

## 🔌 API Reference

### Authentication
- `POST /api/auth/register` — Create account (`username`, `email`, `password`)
- `POST /api/auth/login` — Sign in (`identifier` [email or username], `password`)
- `GET /api/auth/me` — Get current user (Header: `Authorization: Bearer <token>`)
- `GET /api/auth/users` — List workspace members

### Messages
- `GET /api/messages` — Fetch recent message history (Header: `Authorization: Bearer <token>`)

### WebSocket Events
- `join` (`{ username, token, status }`) — Joins chat room, triggers history send
- `chat-message` (`text`) — Sends message, persists to SQLite, broadcasts to room
- `typing` (`boolean`) — Emits typing status
- `users` — Emitted to all clients with active online members
