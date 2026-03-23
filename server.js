const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const fs = require("fs");
const Database = require("sqlite3").verbose();

const app = express();
app.use(express.json());
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Serve static files
app.use(express.static("public"));

// Store connected users
// userId is unique per signed-in account + session identifier
let users = {}; // userId -> {username, sockets:Set, rooms, status}
let socketToUser = {}; // socketId -> {userId, username}
let allUsers = new Set(); // known user list for DM exists check
let offlineMessages = {}; // username -> pending message array

// SQLite database for persistent chat storage
const db = new Database(path.join(__dirname, "chat_database.db"), (err) => {
    if (err) {
        console.error("Failed to open database:", err);
    } else {
        console.log("Connected to SQLite database");
        initializeDatabase();
    }
});

function initializeDatabase() {
    db.serialize(() => {
        db.run(`
            CREATE TABLE IF NOT EXISTS private_chats (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sender TEXT NOT NULL,
                receiver TEXT NOT NULL,
                message TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `, (err) => {
            if (err) console.error("Error creating table:", err);
            else console.log("Private chats table initialized");
        });
    });
}

function addPrivateMessage(from, to, text, timestamp) {
    const message = {
        sender: from,
        receiver: to,
        message: text,
        timestamp: timestamp
    };

    db.run(
        `INSERT INTO private_chats (sender, receiver, message, timestamp) VALUES (?, ?, ?, ?)`,
        [from, to, text, timestamp],
        function(err) {
            if (err) console.error("Error saving message:", err);
        }
    );

    return message;
}

function getPrivateChatKey(user1, user2) {
    return [user1, user2].sort().join("_");
}

function getChatsForUser(username) {
    return new Promise((resolve) => {
        db.all(
            `SELECT DISTINCT 
                CASE 
                    WHEN sender = ? THEN receiver 
                    ELSE sender 
                END as user,
                message as lastMessage,
                timestamp as lastTimestamp
            FROM private_chats
            WHERE sender = ? OR receiver = ?
            ORDER BY timestamp DESC`,
            [username, username, username],
            (err, rows) => {
                if (err) {
                    console.error("Error fetching chats:", err);
                    resolve([]);
                } else {
                    const chats = rows ? rows.map(row => ({
                        user: row.user,
                        lastMessage: row.lastMessage || '',
                        lastTimestamp: row.lastTimestamp || '',
                        online: !!Object.values(users).find(u => u.username === row.user && u.sockets.size > 0),
                        messages: []
                    })) : [];
                    resolve(chats);
                }
            }
        );
    });
}

function getConversation(user1, user2) {
    return new Promise((resolve) => {
        db.all(
            `SELECT sender, receiver, message, timestamp FROM private_chats
            WHERE (sender = ? AND receiver = ?) OR (sender = ? AND receiver = ?)
            ORDER BY timestamp ASC`,
            [user1, user2, user2, user1],
            (err, rows) => {
                if (err) {
                    console.error("Error fetching conversation:", err);
                    resolve([]);
                } else {
                    resolve(rows ? rows.map(row => ({
                        sender: row.sender,
                        receiver: row.receiver,
                        message: row.message,
                        timestamp: row.timestamp
                    })) : []);
                }
            }
        );
    });
}

// Serve HTML files
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/chat", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "chat.html"));
});

// Private chats API
app.get("/api/private-chats/:username", async (req, res) => {
    const username = req.params.username;
    const chats = await getChatsForUser(username);
    chats.sort((a, b) => new Date(b.lastTimestamp).getTime() - new Date(a.lastTimestamp).getTime());
    res.json({ chats });
});

app.get("/api/private-chats/:username/conversation/:other", async (req, res) => {
    const user1 = req.params.username;
    const user2 = req.params.other;
    const conversation = await getConversation(user1, user2);
    res.json({ conversation });
});

app.post("/api/private-chats/message", (req, res) => {
    const { from, to, message, timestamp } = req.body;
    if (!from || !to || !message) {
        return res.status(400).json({ error: "Missing fields" });
    }
    const msg = addPrivateMessage(from, to, message, timestamp || new Date().toISOString());
    res.json({ message: msg });
});

app.delete("/api/private-chats/:username/conversation/:other", (req, res) => {
    const user1 = req.params.username;
    const user2 = req.params.other;
    db.run(
        `DELETE FROM private_chats WHERE (sender = ? AND receiver = ?) OR (sender = ? AND receiver = ?)`,
        [user1, user2, user2, user1],
        (err) => {
            if (err) {
                return res.status(500).json({ error: "Delete failed" });
            }
            res.json({ success: true });
        }
    );
});

// Socket.io connection
io.on("connection", (socket) => {
    console.log(`[${new Date().toLocaleTimeString()}] User connected: ${socket.id}`);

    // User joins
    socket.on("join", ({ username, userId, rooms }) => {
        socketToUser[socket.id] = { userId, username };

        if (!users[userId]) {
            users[userId] = {
                username,
                sockets: new Set(),
                rooms: rooms || [],
                status: "online",
                joinedAt: new Date()
            };
        }

        users[userId].sockets.add(socket.id);
        users[userId].status = "online";

        // Join socket to rooms
        if (rooms && rooms.length > 0) {
            rooms.forEach(room => {
                socket.join(room);
            });
        }

        // Also join general and random if not already
        socket.join("general");
        socket.join("random");

        console.log(`[${new Date().toLocaleTimeString()}] ${username} joined with socket ${socket.id} and userId ${userId}. Active sockets: ${users[userId].sockets.size}`);

        // track all users (for DM availability check)
        allUsers.add(username);

        // Send known users list to all clients
        io.emit("all users", Array.from(allUsers));

        // Send current online users to the new user (exclude themselves)
        const onlineUsersList = Object.values(users)
            .filter(u => u.username !== username && (u.sockets && u.sockets.size > 0))
            .map(user => ({
                userId: Object.keys(users).find(k => users[k].username === user.username),
                username: user.username
            }));
        socket.emit("online users", onlineUsersList);

        // Notify ALL users that someone joined (send to everyone including new user)
        io.emit("user joined", {
            username,
            userId,
            timestamp: new Date().toLocaleTimeString()
        });

        // Also send updated online users list to everyone
        const updatedOnlineUsers = Object.values(users)
            .map(user => ({
                userId: Object.keys(users).find(k => users[k].username === user.username),
                username: user.username
            }));
        io.emit("updated online users", updatedOnlineUsers);

        // Send private chat summary to the joining user
        getChatsForUser(username).then(chats => {
            socket.emit("private chats", { chats });
        }).catch(err => console.error("Error fetching chats on join:", err));

        // Send offline pending messages to user (if any)
        if (offlineMessages[username] && offlineMessages[username].length > 0) {
            offlineMessages[username].forEach(msg => {
                socket.emit("private message", msg);
            });
            delete offlineMessages[username];
        }
    });

    // Group message
    socket.on("chat message", (data) => {
        const messageData = {
            ...data,
            timestamp: new Date().toISOString()
        };
        io.to(data.room).emit("chat message", messageData);
        console.log(`[${new Date().toLocaleTimeString()}] Message in ${data.room}: ${data.user} - ${data.text}`);
    });

    // Private message
    socket.on("private message", (data) => {
        const normalizedTo = data.to && data.to.trim();
        if (!normalizedTo || !allUsers.has(normalizedTo)) {
            socket.emit("error", { message: "User not found" });
            return;
        }

        const senderSession = socketToUser[socket.id];
        const senderName = senderSession ? senderSession.username : data.from;

        const messageData = {
            sender: senderName,
            receiver: normalizedTo,
            text: data.text,
            timestamp: new Date().toISOString()
        };

        // Persist in private store
        addPrivateMessage(senderName, normalizedTo, data.text, messageData.timestamp);

        const recipientUserId = Object.keys(users).find(
            uid => users[uid].username === normalizedTo
        );

        if (recipientUserId) {
            const recipientSocket = Array.from(users[recipientUserId].sockets)[0];
            io.to(recipientSocket).emit("private message", messageData);
            socket.emit("private message", messageData); // echo back to sender
            console.log(`[${new Date().toLocaleTimeString()}] Private message: ${senderName} → ${normalizedTo}`);
        } else {
            // User is offline, queue message for later delivery
            offlineMessages[normalizedTo] = offlineMessages[normalizedTo] || [];
            offlineMessages[normalizedTo].push(messageData);
            socket.emit("private message", messageData); // also show sender copy
            console.log(`[${new Date().toLocaleTimeString()}] Queued private message for offline user: ${data.from} → ${normalizedTo}`);
        }

        // Update chats for sender and recipient (if online)
        getChatsForUser(senderName).then(chats => {
            socket.emit("private chats", { chats });
        });
        if (recipientUserId) {
            getChatsForUser(normalizedTo).then(chats => {
                const recipientSockets = users[recipientUserId]?.sockets || new Set();
                recipientSockets.forEach(sid => io.to(sid).emit("private chats", { chats }));
            });
        }
    });

    // Typing indicator
    socket.on("typing", (data) => {
        if (data.room) {
            // Group chat typing
            socket.to(data.room).emit("typing", {
                user: data.user,
                room: data.room,
                type: "room"
            });
        } else if (data.to) {
            // Private chat typing
            const recipientUserIdForTyping = Object.keys(users).find(uid => users[uid].username === data.to);
            if (recipientUserIdForTyping) {
                const recipientSockets = users[recipientUserIdForTyping].sockets || new Set();
                recipientSockets.forEach(sid => {
                    io.to(sid).emit("typing", {
                        user: data.user,
                        to: data.to,
                        type: "private"
                    });
                });
            }
        }
    });

    // User disconnects
    socket.on("disconnect", () => {
        const session = socketToUser[socket.id];
        if (!session) {
            console.log(`[${new Date().toLocaleTimeString()}] Disconnected unknown socket ${socket.id}`);
            return;
        }

        const { userId, username } = session;
        delete socketToUser[socket.id];

        if (users[userId]) {
            users[userId].sockets.delete(socket.id);
            if (users[userId].sockets.size === 0) {
                users[userId].status = "offline";
                console.log(`[${new Date().toLocaleTimeString()}] User disconnected (offline): ${username}`);

                // Notify others once user fully offline
                io.emit("user left", {
                    username,
                    userId,
                    timestamp: new Date().toLocaleTimeString()
                });

                // Keep user in allUsers for DM history, but set offline status
                delete users[userId];
            } else {
                console.log(`[${new Date().toLocaleTimeString()}] User connection closed, still active elsewhere: ${username}`);
            }
        }

        const updatedOnlineUsers = Object.values(users)
            .filter(u => u.sockets && u.sockets.size > 0)
            .map(user => ({
                userId: Object.keys(users).find(k => users[k].username === user.username),
                username: user.username
            }));
        io.emit("updated online users", updatedOnlineUsers);
    });

    // Handle errors
    socket.on("error", (error) => {
        console.error(`Socket error for ${socket.id}:`, error);
    });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`
    ╔════════════════════════════════════╗
    ║   Real-Time Chat App               ║
    ║   Server running on port ${PORT}        ║
    ║   http://localhost:${PORT}           ║
    ╚════════════════════════════════════╝
    `);
});

// Graceful shutdown
process.on("SIGINT", () => {
    console.log("\nShutting down server...");
    io.close();
    server.close(() => {
        console.log("Server closed");
        process.exit(0);
    });
});