const socket = io();

// User data
let username = sessionStorage.getItem("username") || localStorage.getItem("username");
let userId = sessionStorage.getItem("userId") || localStorage.getItem("userId");
let rooms = JSON.parse(sessionStorage.getItem("rooms") || localStorage.getItem("rooms") || "[]");
rooms = rooms.filter(r => !['general','random'].includes(r.toLowerCase()));

if (!username || !userId) {
    // For security and session isolation, do not autofill from a different tab.
    window.location.href = "index.html";
}


// Chat state
let currentRoom = null;
let currentPrivateUser = null;
let onlineUsers = {}; // live presence map for online users
let knownUsers = []; // includes all known usernames from server
let contacts = {}; // map of all synced contacts
let messageHistory = {};
let privateChatSummaries = {}; // username -> {lastMessage,lastTimestamp,unreadCount,online}
let typingUserTimers = {}; // typing timers per user

// Load message history from localStorage
function loadMessageHistory() {
    const saved = localStorage.getItem("messageHistory_" + username);
    if (saved) {
        try {
            messageHistory = JSON.parse(saved);
        } catch (e) {
            messageHistory = {};
        }
    }
}

function rebuildPrivateSummariesFromHistory() {
    Object.keys(messageHistory).forEach(key => {
        if (!key.includes("_")) return;
        const participants = key.split("_");
        if (!participants.includes(username)) return;

        const otherUser = participants.find(u => u !== username);
        const messages = messageHistory[key];
        if (!Array.isArray(messages) || messages.length === 0) return;

        const lastMessageObject = messages[messages.length - 1];
        const lastTimestamp = lastMessageObject.timestamp || "";
        const lastText = lastMessageObject.text || lastMessageObject.message || "";

        privateChatSummaries[otherUser] = {
            lastMessage: lastText,
            lastTimestamp: lastTimestamp,
            unreadCount: privateChatSummaries[otherUser]?.unreadCount || 0,
            online: !!onlineUsers[otherUser]
        };
    });
    renderPrivateChatList();
}

// Save message history to localStorage
function saveMessageHistory() {
    localStorage.setItem("messageHistory_" + username, JSON.stringify(messageHistory));
}

// Load online users from localStorage
function loadOnlineUsers() {
    const saved = localStorage.getItem("onlineUsers_" + username);
    if (saved) {
        try {
            onlineUsers = JSON.parse(saved);
        } catch (e) {
            onlineUsers = {};
        }
    }
}

// Save online users to localStorage
function saveOnlineUsers() {
    localStorage.setItem("onlineUsers_" + username, JSON.stringify(onlineUsers));
}

// Set user avatar
function getAvatar(name) {
    return name.charAt(0).toUpperCase();
}

// Initialize chat
window.addEventListener('DOMContentLoaded', () => {
    if (!username) {
        window.location.href = "index.html";
        return;
    }

    // Load persisted data
    loadMessageHistory();
    rebuildPrivateSummariesFromHistory();
    loadOnlineUsers();
    syncContacts();  // Display loaded contacts

    document.getElementById("currentUsername").textContent = username;
    document.getElementById("userAvatar").textContent = getAvatar(username);
    const statusElement = document.querySelector('.user-details .status');
    if (statusElement) {
        statusElement.textContent = '● Online';
        statusElement.classList.add('online');
    }

    // Load persisted private chats from backend API
    fetch(`/api/private-chats/${encodeURIComponent(username)}`)
        .then(response => response.json())
        .then(data => {
            if (data && data.chats) {
                data.chats.forEach(chat => {
                    privateChatSummaries[chat.user] = {
                        lastMessage: chat.lastMessage || '',
                        lastTimestamp: chat.lastTimestamp || '',
                        unreadCount: 0,
                        online: chat.online
                    };
                });
                renderPrivateChatList();
            }
        })
        .catch(err => console.warn('Failed to load private chats', err));

    requestPermissions();
    loadSettings();

    // Join socket
    socket.emit("join", { username, userId, rooms });
    
    // Setup room list
    if (rooms.length > 0) {
        rooms.forEach(room => {
            const li = document.createElement("li");
            li.className = "room-item";
            li.setAttribute("data-room", room);
            li.textContent = room; // removed icon prefix
            li.onclick = () => selectRoom(room);
            document.getElementById("roomList").appendChild(li);
        });
        selectRoom(rooms[0]);
    }

function getRoomIcon(room) {
    const lower = room.toLowerCase();
    if (lower.includes('anime')) return '🎎';
    if (lower.includes('sports')) return '🏆';
    if (lower.includes('music')) return '🎵';
    if (lower.includes('movies')) return '🎬';
    if (lower.includes('tech')) return '💻';
    if (lower.includes('gaming')) return '🎮';
    if (lower.includes('food')) return '🍲';
    if (lower.includes('random')) return '🌐';
    if (lower.includes('general')) return '💬';
    return '🌀';
}
    
    // Initialize message history
    rooms.forEach(room => messageHistory[room] = []);

});

// Select room
function selectRoom(room) {
    currentRoom = room;
    currentPrivateUser = null;
    document.getElementById("messagesContainer").innerHTML = "";
    document.getElementById("chatTitle").textContent = room;
    document.getElementById("chatInfo").textContent = `Members: ${Object.keys(onlineUsers).length + 1}`;
    
    // Highlight selected room
    document.querySelectorAll(".room-item").forEach(el => {
        el.classList.remove("active");
        if (el.textContent.includes(room)) {
            el.classList.add("active");
        }
    });

    // Display message history (reload from localStorage if exists)
    if (messageHistory[room]) {
        messageHistory[room].forEach(msg => displayMessage(msg));
    }
    
    // Auto-scroll to bottom
    const container = document.getElementById("messagesContainer");
    container.scrollTop = container.scrollHeight;

    // Clear private list selection
    document.querySelectorAll(".private-item").forEach(el => el.classList.remove("active"));
}

// Select private user
function selectPrivateUser(user) {
    currentPrivateUser = user;
    currentRoom = null;
    document.getElementById("messagesContainer").innerHTML = "";
    document.getElementById("chatTitle").textContent = "💬 " + user;
    document.getElementById("chatInfo").textContent = "Direct Message";
    
    // Highlight selected user
    document.querySelectorAll(".private-item").forEach(el => {
        el.classList.remove("active");
        if (el.textContent.includes(user)) {
            el.classList.add("active");
        }
    });

    // Display private chat history
    const key = [username, user].sort().join("_");
    const container = document.getElementById("messagesContainer");
    container.innerHTML = '';

    const displayConversation = (msgs) => {
        msgs.forEach(msg => displayMessage(msg));
        container.scrollTop = container.scrollHeight;
    };

    if (messageHistory[key] && messageHistory[key].length) {
        displayConversation(messageHistory[key]);
    } else {
        // Fetch from backend if not in memory
        fetch(`/api/private-chats/${encodeURIComponent(username)}/conversation/${encodeURIComponent(user)}`)
            .then(resp => resp.json())
            .then(data => {
                messageHistory[key] = data.conversation.map(msg => {
                    const isSent = msg.sender === username;
                    return { ...msg, isSent, from: msg.sender, to: msg.receiver, text: msg.message };
                });
                displayConversation(messageHistory[key]);
            }).catch(err => {
                console.warn('Failed to load conversation data', err);
            });
    }

    // Auto-scroll to bottom
    container.scrollTop = container.scrollHeight;

    // Clear room selection
    document.querySelectorAll(".room-item").forEach(el => el.classList.remove("active"));
    if (privateChatSummaries[user]) {
        privateChatSummaries[user].unreadCount = 0;
    }
    renderPrivateChatList();
}

// Send message
function sendMessage() {
    const input = document.getElementById("messageInput");
    const text = input.value.trim();

    if (!text) return;

    const timestamp = new Date().toISOString();
    
    if (currentPrivateUser) {
        const messageData = {
            from: username,
            to: currentPrivateUser,
            text: text,
            timestamp: timestamp,
            userId: userId
        };
        socket.emit("private message", messageData);
        
        const key = [username, currentPrivateUser].sort().join("_");
        if (!messageHistory[key]) messageHistory[key] = [];
        messageHistory[key].push({...messageData, isSent: true});
        saveMessageHistory();

        // Don't double render; server emits private message back for display
        upsertPrivateChat(currentPrivateUser, text, timestamp, true, false);
    } else if (currentRoom) {
        const messageData = {
            user: username,
            room: currentRoom,
            text: text,
            timestamp: timestamp,
            userId: userId
        };
        socket.emit("chat message", messageData);
        
        if (!messageHistory[currentRoom]) messageHistory[currentRoom] = [];
        messageHistory[currentRoom].push({...messageData, isSent: true});
        saveMessageHistory();
        displayMessage({...messageData, isSent: true});
    }

    input.value = "";
    input.focus();
}

// Display message
function formatTimestamp(ts) {
    if (!ts) return "";
    const date = new Date(ts);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function displayMessage(data) {
    const container = document.getElementById("messagesContainer");
    
    const messageDiv = document.createElement("div");
    messageDiv.className = "message-wrapper " + (data.isSent ? "sent" : "received");
    
    const isSent = data.isSent || (data.from && data.from === username) || (data.user && data.user === username);
    
    messageDiv.innerHTML = `
        <div class="message">
            <div class="message-author">${isSent ? "You" : (data.from || data.user)}</div>
            <div class="message-content">${escapeHtml(data.text)}</div>
            <div class="message-time">${formatTimestamp(data.timestamp)}</div>
        </div>
    `;
    
    container.appendChild(messageDiv);
    container.scrollTop = container.scrollHeight;
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
}

// Socket Events

// Receive group message
socket.on("chat message", (data) => {
    if (!messageHistory[data.room]) messageHistory[data.room] = [];
    messageHistory[data.room].push(data);
    saveMessageHistory();
    
    if (currentRoom === data.room && data.user !== username) {
        displayMessage(data);
    }
});

// Receive private message
socket.on("private message", (data) => {
    const from = data.from || data.sender;
    const to = data.to || data.receiver;
    const text = data.text || data.message || "";
    const timestamp = data.timestamp || new Date().toISOString();

    const key = [from, to].sort().join("_");
    if (!messageHistory[key]) messageHistory[key] = [];

    const messagePayload = {
        from,
        to,
        text,
        timestamp,
        isSent: from === username
    };

    messageHistory[key].push(messagePayload);
    saveMessageHistory();

    const isSent = from === username;
    const otherUser = isSent ? to : from;
    addPrivateChat(otherUser);
    upsertPrivateChat(otherUser, text, timestamp, !!onlineUsers[otherUser], !isSent);

    if (currentPrivateUser === otherUser) {
        displayMessage(messagePayload);
        privateChatSummaries[otherUser].unreadCount = 0;
        renderPrivateChatList();
    } else {
        if (!isSent) {
            showNotification(`New message from ${from}`);
        }
    }
});

// Online users list - Initial load
socket.on("online users", (users) => {
    onlineUsers = {};
    users.forEach(user => {
        if (user.username && user.username !== username) {
            onlineUsers[user.username] = true;
        }
    });
    saveOnlineUsers();
    syncContacts();

    Object.keys(privateChatSummaries).forEach(user => {
        privateChatSummaries[user].online = !!onlineUsers[user];
    });
    renderPrivateChatList();
});

// Updated online users - Real-time updates
socket.on("updated online users", (users) => {
    onlineUsers = {};
    users.forEach(user => {
        if (user.username && user.username !== username) {
            onlineUsers[user.username] = true;
        }
    });
    saveOnlineUsers();
    syncContacts();

    Object.keys(privateChatSummaries).forEach(user => {
        privateChatSummaries[user].online = !!onlineUsers[user];
    });
    renderPrivateChatList();
});

// Known users list (all users seen on server)
socket.on("all users", (users) => {
    knownUsers = users || [];
    syncContacts();
});

// User joined
socket.on("user joined", (data) => {
    if (data.username !== username) { // Don't add yourself
        onlineUsers[data.username] = true;
        saveOnlineUsers();
        syncContacts();
        showNotification(`${data.username} joined`);
    }
    
    if (currentRoom) {
        document.getElementById("chatInfo").textContent = `Members: ${Object.keys(onlineUsers).length + 1}`;
    }
});

// User left
socket.on("user left", (data) => {
    delete onlineUsers[data.username];
    saveOnlineUsers();
    syncContacts();
    
    if (currentRoom) {
        document.getElementById("chatInfo").textContent = `Members: ${Object.keys(onlineUsers).length}`;
    }
    
    showNotification(`${data.username} left`);
});

// Sync contacts from known users and presence map
function syncContacts() {
    contacts = {};
    knownUsers.forEach(name => {
        if (name !== username) {
            contacts[name] = {
                online: !!onlineUsers[name],
                typing: false
            };
        }
    });
    Object.keys(onlineUsers).forEach(name => {
        if (name !== username) {
            contacts[name] = contacts[name] || { online: true, typing: false };
            contacts[name].online = true;
        }
    });
    updateContacts();
}

function updateContacts() {
    const contactList = document.getElementById('contacts');
    if (!contactList) return;
    contactList.innerHTML = '';

    const names = Object.keys(contacts).sort((a, b) => a.localeCompare(b));
    if (names.length === 0) {
        const empty = document.createElement('li');
        empty.className = 'user-item no-users';
        empty.textContent = 'No contacts available';
        contactList.appendChild(empty);
        return;
    }

    names.forEach(name => {
        const data = contacts[name];
        const li = document.createElement('li');
        const statusClass = data.typing ? 'typing' : (data.online ? 'online' : 'offline');
        li.className = `user-item contact-item ${statusClass}`;
        li.setAttribute('data-username', name);

        const text = data.typing ? `${name} is typing...` : name;
        li.textContent = text;

        li.onclick = () => selectPrivateUser(name);
        contactList.appendChild(li);
    });

    // maintain room count text when room selected
    if (currentRoom) {
        document.getElementById('chatInfo').textContent = `Members: ${Object.keys(onlineUsers).length + 1}`;
    }
}

function renderPrivateChatList() {
    const privateList = document.getElementById('privateChats');
    if (!privateList) return;
    privateList.innerHTML = '';

    const entries = Object.entries(privateChatSummaries);
    entries.sort((a, b) => {
        const ta = new Date(a[1].lastTimestamp).getTime();
        const tb = new Date(b[1].lastTimestamp).getTime();
        return tb - ta;
    });

    if (entries.length === 0) {
        const empty = document.createElement('li');
        empty.className = 'private-item no-users';
        empty.textContent = 'No direct messages yet';
        privateList.appendChild(empty);
        return;
    }

    entries.forEach(([user, meta]) => {
        const li = document.createElement('li');
        li.className = 'private-item';
        if (currentPrivateUser === user) li.classList.add('active');
        li.setAttribute('data-private-user', user);
        li.style.position = 'relative';

        const onlineDot = document.createElement('span');
        onlineDot.className = `status-dot ${meta.online ? 'online' : 'offline'}`;
        onlineDot.style.marginRight = '8px';
        onlineDot.style.width = '8px';
        onlineDot.style.height = '8px';

        const textWrap = document.createElement('span');
        textWrap.className = 'private-chat-text';
        textWrap.innerHTML = `<strong>${user}</strong><br><small>${meta.lastMessage || 'No messages yet'}</small>`;

        const timeBadge = document.createElement('span');
        timeBadge.className = 'badge time-badge';
        timeBadge.textContent = meta.lastTimestamp ? formatTimestamp(meta.lastTimestamp) : '';
        timeBadge.style.marginLeft = 'auto';
        timeBadge.style.fontSize = '0.7rem';

        const unreadBadge = document.createElement('span');
        unreadBadge.className = 'badge unread-badge';
        unreadBadge.textContent = meta.unreadCount > 0 ? meta.unreadCount : '';
        unreadBadge.style.display = meta.unreadCount > 0 ? 'inline-block' : 'none';

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'private-item-delete-btn';
        deleteBtn.textContent = '✕';
        deleteBtn.title = 'Delete conversation';
        deleteBtn.onclick = (e) => {
            e.stopPropagation();
            deleteConversation(user);
        };

        li.appendChild(onlineDot);
        li.appendChild(textWrap);
        li.appendChild(timeBadge);
        li.appendChild(unreadBadge);
        li.appendChild(deleteBtn);

        li.onclick = () => {
            selectPrivateUser(user);
            meta.unreadCount = 0;
            renderPrivateChatList();
        };

        privateList.appendChild(li);
    });
}

function upsertPrivateChat(user, lastMessage, timestamp, online, isIncoming = true) {
    const existing = privateChatSummaries[user] || {lastMessage: '', lastTimestamp: '', unreadCount: 0, online: false};
    existing.lastMessage = lastMessage;
    existing.lastTimestamp = timestamp;
    existing.online = online !== undefined ? online : existing.online;
    if (isIncoming && currentPrivateUser !== user) {
        existing.unreadCount = (existing.unreadCount || 0) + 1;
    }
    privateChatSummaries[user] = existing;
    renderPrivateChatList();

    if (isIncoming && currentPrivateUser !== user) {
        const dmElement = document.querySelector(`[data-private-user="${user}"]`);
        if (dmElement) {
            dmElement.classList.add('new-message');
            setTimeout(() => dmElement.classList.remove('new-message'), 600);
        }
    }
}

function setContactTyping(user, isTyping) {
    if (!contacts[user]) {
        contacts[user] = { online: !!onlineUsers[user], typing: false };
    }
    contacts[user].typing = isTyping;
    updateContacts();
}

// Typing indicator
let typingTimeout;
let typingIndicators = {}; // Track typing status
const messageInput = document.getElementById("messageInput");

messageInput.addEventListener("input", () => {
    if (currentRoom) {
        socket.emit("typing", {
            user: username,
            room: currentRoom,
            type: "room"
        });
    } else if (currentPrivateUser) {
        socket.emit("typing", {
            user: username,
            to: currentPrivateUser,
            type: "private"
        });
    }
});

socket.on("private chats", (data) => {
    if (!data || !data.chats) return;

    data.chats.forEach(chat => {
        privateChatSummaries[chat.user] = {
            lastMessage: chat.lastMessage || '',
            lastTimestamp: chat.lastTimestamp || '',
            unreadCount: privateChatSummaries[chat.user]?.unreadCount || 0,
            online: chat.online
        };
    });
    renderPrivateChatList();
});

socket.on("typing", (data) => {
    if (data.type === "room" && data.user !== username) {
        // Show in main indicator if this room is open
        if (currentRoom === data.room) {
            document.getElementById("typingUser").textContent = data.user + " is typing...";
            document.getElementById("typingIndicator").style.display = "flex";
        }
        
        // Show under room name in sidebar
        const roomItem = document.querySelector(`[data-room="${data.room}"]`);
        if (roomItem) {
            let typingLabel = roomItem.querySelector(".typing-label");
            if (!typingLabel) {
                typingLabel = document.createElement("small");
                typingLabel.className = "typing-label";
                roomItem.appendChild(typingLabel);
            }
            typingLabel.textContent = ` 💬 ${data.user} typing...`;
            typingLabel.style.color = "#888";
            typingLabel.style.fontSize = "0.8em";
        }
        
        clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => {
            document.getElementById("typingIndicator").style.display = "none";
            if (roomItem) {
                const typingLabel = roomItem.querySelector(".typing-label");
                if (typingLabel) typingLabel.remove();
            }
        }, 3000);
    } else if (data.type === "private" && data.user !== username) {
        // Show in main indicator if this private chat is open
        if (currentPrivateUser === data.user) {
            document.getElementById("typingUser").textContent = data.user + " is typing...";
            document.getElementById("typingIndicator").style.display = "flex";
        }
        
        // Update contact list typing state
        setContactTyping(data.user, true);

        if (typingUserTimers[data.user]) {
            clearTimeout(typingUserTimers[data.user]);
        }
        typingUserTimers[data.user] = setTimeout(() => {
            setContactTyping(data.user, false);
            delete typingUserTimers[data.user];
            if (currentPrivateUser === data.user) {
                document.getElementById("typingIndicator").style.display = "none";
            }
        }, 3000);

        // Also preserve old small typing under direct message pane
        const privateChatItem = document.querySelector(`[data-private-user="${data.user}"]`);
        if (privateChatItem) {
            let typingLabel = privateChatItem.querySelector(".typing-label");
            if (!typingLabel) {
                typingLabel = document.createElement("small");
                typingLabel.className = "typing-label";
                privateChatItem.appendChild(typingLabel);
            }
            typingLabel.textContent = ` 💬 typing...`;
            typingLabel.style.color = "#888";
            typingLabel.style.fontSize = "0.8em";
        }
        
        clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => {
            if (currentPrivateUser !== data.user) {
                document.getElementById("typingIndicator").style.display = "none";
            }
            if (privateChatItem) {
                const typingLabel = privateChatItem.querySelector(".typing-label");
                if (typingLabel) typingLabel.remove();
            }
        }, 3000);
    }
});

// Start private chat
function startPrivate() {
    const user = document.getElementById("privateUser").value.trim();
    
    if (!user || user === username) {
        alert("Enter a valid username");
        return;
    }
    
    const lowerKnown = knownUsers.map(u => u.toLowerCase());
    if (!lowerKnown.includes(user.toLowerCase())) {
        alert("User not found");
        return;
    }
    
    addPrivateChat(user);
    selectPrivateUser(user);
    document.getElementById("privateUser").value = "";
}

// Add private chat
function addPrivateChat(user) {
    if (!privateChatSummaries[user]) {
        privateChatSummaries[user] = {
            lastMessage: '',
            lastTimestamp: '',
            unreadCount: 0,
            online: !!onlineUsers[user]
        };
    }
    renderPrivateChatList();
}

function deleteConversation(user) {
    if (!confirm(`Delete conversation with ${user}? This cannot be undone.`)) {
        return;
    }

    const key = [username, user].sort().join("_");
    if (messageHistory[key]) {
        delete messageHistory[key];
        saveMessageHistory();
    }

    delete privateChatSummaries[user];
    renderPrivateChatList();

    fetch(`/api/private-chats/${encodeURIComponent(username)}/conversation/${encodeURIComponent(user)}`, {
        method: "DELETE"
    }).then(resp => resp.json()).catch(err => console.error('Delete failed:', err));

    if (currentPrivateUser === user) {
        currentPrivateUser = null;
        document.getElementById("messagesContainer").innerHTML = '<div class="welcome-message"><h2>Welcome to ChatHub! 👋</h2><p>Select a room or user to start messaging</p></div>';
    }
}

// Logout
function logout() {
    // Clear only chat state for this tab, keep account mapping in localStorage
    messageHistory = {};
    onlineUsers = {};
    sessionStorage.removeItem("username");
    sessionStorage.removeItem("userId");
    sessionStorage.removeItem("rooms");
    socket.disconnect();
    window.location.href = "index.html";
}

// Clear chat
function clearChat() {
    const container = document.getElementById("messagesContainer");
    if (currentRoom || currentPrivateUser) {
        container.innerHTML = '<div class="welcome-message"><p>Chat cleared</p></div>';
    }
}

// Settings
function showSettings() {
    document.getElementById('settingsPanel').style.display = 'block';
    document.getElementById('messagesContainer').style.display = 'none';
    document.getElementById('typingIndicator').style.display = 'none';
}

function closeSettings() {
    document.getElementById('settingsPanel').style.display = 'none';
    document.getElementById('messagesContainer').style.display = 'flex';
}

function openSettingsTab(tab) {
    document.querySelectorAll('.settings-tab').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.settings-content').forEach(content => content.style.display = 'none');

    document.getElementById(tab).style.display = 'block';
    document.querySelector(`.settings-tab[onclick="openSettingsTab('${tab}')"]`).classList.add('active');
}

function saveSettings() {
    const darkMode = document.getElementById('darkMode').checked;
    const messageSound = document.getElementById('messageSound').checked;

    if (darkMode) {
        document.body.classList.add('dark-mode');
    } else {
        document.body.classList.remove('dark-mode');
    }

    localStorage.setItem('chat_app_settings', JSON.stringify({ darkMode, messageSound }));
    alert('Settings saved');
    closeSettings();
}

function loadSettings() {
    const settings = JSON.parse(localStorage.getItem('chat_app_settings') || '{}');
    if (settings.darkMode) {
        document.body.classList.add('dark-mode');
        document.getElementById('darkMode').checked = true;
    }
    if (settings.messageSound !== undefined) {
        document.getElementById('messageSound').checked = settings.messageSound;
    }
}

// Show notification
function showNotification(message) {
    console.log("Notification:", message);
    const statusEl = document.getElementById('permissionStatus');
    if (statusEl) {
        statusEl.textContent = message;
    }
}

function setPermissionStatus(message, isError = false) {
    const el = document.getElementById('permissionStatus');
    if (!el) return;
    el.textContent = message;
    el.style.color = isError ? '#e74c3c' : '#27ae60';
}

function requestPermissions() {
    setPermissionStatus('Requesting app permissions...');

    // Notification permission
    if ('Notification' in window) {
        Notification.requestPermission().then(result => {
            if (result === 'granted') {
                setPermissionStatus('Notifications enabled');
            } else {
                setPermissionStatus('Notifications blocked', true);
            }
        });
    }

    // Geolocation permission
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            () => setPermissionStatus('Location permission granted'),
            () => setPermissionStatus('Location permission denied', true)
        );
    }

    // Microphone/camera permission
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        navigator.mediaDevices.getUserMedia({ audio: true, video: true })
            .then(stream => {
                // stop tracks after requesting permission
                stream.getTracks().forEach(t => t.stop());
                setPermissionStatus('Camera/Microphone permission granted');
            })
            .catch(() => setPermissionStatus('Camera/Microphone permission denied', true));
    }

    // Contacts permission is not standardized in web, simulate message
    if ('contacts' in navigator) {
        navigator.contacts.select(['name', 'email', 'tel'], { multiple: false })
            .then(() => setPermissionStatus('Contacts permission granted (simulated)'))
            .catch(() => setPermissionStatus('Contacts permission denied (simulated)', true));
    } else {
        setPermissionStatus('Contact permission not supported in browser; using local contact state');
    }
}

function startCall() {
    if (!currentPrivateUser && !currentRoom) {
        alert('Select a room or contact first to start a call.');
        return;
    }
    const target = currentPrivateUser || currentRoom;
    alert(`Starting voice call with ${target}. (Mock feature)`);
    showNotification(`📞 Voice call started: ${target}`);
}

function startVideoCall() {
    if (!currentPrivateUser && !currentRoom) {
        alert('Select a room or contact first to start a video call.');
        return;
    }
    const target = currentPrivateUser || currentRoom;
    alert(`Starting video call with ${target}. (Mock feature)`);
    showNotification(`🎥 Video call started: ${target}`);
}

function triggerShareMedia() {
    const input = document.getElementById('mediaInput');
    if (input) input.click();
}

function handleMediaSelection(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const messageData = {
        user: username,
        text: `Media shared: ${file.name}`,
        timestamp,
        isSent: true
    };

    if (currentRoom) {
        messageHistory[currentRoom] = messageHistory[currentRoom] || [];
        messageHistory[currentRoom].push(messageData);
        saveMessageHistory();
    } else if (currentPrivateUser) {
        const key = [username, currentPrivateUser].sort().join('_');
        messageHistory[key] = messageHistory[key] || [];
        messageHistory[key].push(messageData);
        saveMessageHistory();
    }

    displayMessage({...messageData, text: `<strong>📎 Shared:</strong> ${file.name}<br><em>Click to preview</em>`});

    const reader = new FileReader();
    reader.onload = function(e) {
        if (!e.target.result) return;
        if (file.type.startsWith('image/')) {
            displayMessage({isSent:true, text: `<img src="${e.target.result}" alt="${file.name}" class="shared-media-preview">`, timestamp});
        } else if (file.type.startsWith('video/')) {
            displayMessage({isSent:true, text: `<video controls class="shared-media-preview"><source src="${e.target.result}" type="${file.type}"></video>`, timestamp});
        } else {
            displayMessage({isSent:true, text: `<span class="shared-media-text">File: ${file.name} (${(file.size/1024).toFixed(2)} KB)</span>`, timestamp});
        }
    };
    reader.readAsDataURL(file);
}

function filterContactsRooms() {
    const query = document.getElementById('globalSearch').value.toLowerCase();
    ['roomList', 'privateChats'].forEach(listId => {
        const list = document.getElementById(listId);
        if (!list) return;
        Array.from(list.children).forEach(item => {
            const text = item.textContent.toLowerCase();
            item.style.display = text.includes(query) ? '' : 'none';
        });
    });
}

// Allow Enter key to send message
document.addEventListener('keypress', function(e) {
    if (e.key === 'Enter' && e.target.id === 'messageInput') {
        sendMessage();
    }
});