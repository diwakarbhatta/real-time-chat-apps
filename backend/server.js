const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "../fronted")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../fronted/index.html"));
});

const users = new Map();

io.on("connection", (socket) => {
  socket.on("join", ({ username, status }) => {
    users.set(socket.id, {
      username: username || "Guest",
      status: status || "Online",
      id: socket.id,
    });
    io.emit("users", Array.from(users.values()));
    io.emit("system", `${username || "Guest"} joined the room`);
  });

  socket.on("chat-message", (text) => {
    const user = users.get(socket.id);
    if (!user || typeof text !== "string") return;
    const trimmed = text.trim();
    if (!trimmed) return;
    io.emit("chat-message", {
      id: `${Date.now()}-${socket.id}`,
      username: user.username,
      text: trimmed.slice(0, 1000),
      time: new Date().toISOString(),
      from: socket.id,
    });
  });

  socket.on("disconnect", () => {
    const user = users.get(socket.id);
    users.delete(socket.id);
    if (user) io.emit("system", `${user.username} left the room`);
    io.emit("users", Array.from(users.values()));
  });
});

const PORT = 5000;

server.listen(PORT, () => {
  console.log(`Pulse Chat running at http://localhost:${PORT}`);
});
