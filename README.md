# Real-Time Chat App 💬

A modern, fully-featured real-time chat application built with **Node.js**, **Express**, **Socket.io**, and **Vanilla JavaScript**. It mimics the functionality of popular messaging platforms like WhatsApp Web, Messenger, and Slack.

---

## 🎯 Key Features

### ✅ User Authentication
- **Login System**: Username and password authentication
- **Sign Up System**: Create new accounts with username and password validation
- **Session Management**: User sessions stored in localStorage
- **Interest Selection**: Users select interests during signup to join relevant chat rooms

### 💬 Messaging Features
- **Group Chat**: Multiple public chat rooms (General, Random, Interest-based)
- **One-to-One Chat**: Direct messaging between users
- **Instant Messaging**: Real-time message delivery using Socket.io
- **Message History**: Chat history is preserved during the session
- **Timestamps**: Every message displays the time it was sent

### ⌨️ Typing Indicators
- **Live Typing Status**: Shows when other users are typing
- **Auto-hide**: Typing indicator disappears after 2 seconds of inactivity
- **Smart Display**: Only shown in relevant chat context

### 👥 User Management
- **Online Users List**: Real-time display of all connected users
- **User Status**: Shows online/offline status with visual indicators
- **Join/Leave Notifications**: Users are notified when others join or leave
- **User Profiles**: Simple user avatars with initials

### 🎨 UI/UX Features
- **Modern Design**: Beautiful gradient-based interface with smooth animations
- **Responsive Layout**: Optimized for desktop and mobile devices
- **Intuitive Navigation**: Easy room switching and user selection
- **Message Formatting**: Sent messages on right (purple gradient), received on left (gray)
- **Smooth Animations**: Fade-in effects and typing animations
- **Dark Sidebar**: Professional dark theme for better contrast
- **Interactive Elements**: Hover effects and visual feedback on all buttons

---

## 📦 Technology Stack

| Technology | Purpose |
|-----------|---------|
| **Node.js** | Backend runtime |
| **Express.js** | Web framework |
| **Socket.io** | Real-time bidirectional communication |
| **Vanilla JavaScript** | Frontend logic (no frameworks) |
| **HTML5** | Markup structure |
| **CSS3** | Modern styling with gradients and animations |

---

## 🚀 Installation & Setup

### Prerequisites
- **Node.js** (v14 or higher)
- **npm** (comes with Node.js)

### Steps

1. **Clone or Download the Repository**
```bash
git clone <repository-url>
cd Real-Time-chat-App
```

2. **Install Dependencies**
```bash
npm install
```

3. **Start the Server**
```bash
npm start
```

The server will start on `http://localhost:3000`

4. **Open in Browser**
- Navigate to `http://localhost:3000` in your web browser
- Create an account or login
- Select interests and start chatting!

---

## 📁 Project Structure

```
Real-Time-chat-App/
│
├── public/                    # Frontend files
│   ├── index.html            # Login/Signup page
│   ├── chat.html             # Main chat interface
│   ├── script.js             # Frontend Socket.io logic
│   ├── style.css             # All styling (auth + chat)
│   └── interests.html        # (Optional) Interest selection page
│
├── server.js                  # Backend server & Socket.io setup
├── package.json              # Project dependencies
└── README.md                 # This file
```

---

## 💡 How It Works

### Authentication Flow
1. User lands on login page (`/`)
2. Can either **Login** with existing credentials or **Sign Up** for new account
3. On signup, user selects interests (anime, sports, gaming, music, tech, movies)
4. User data and session stored in localStorage
5. Redirected to chat page (`/chat`)

### Chat Room Flow
1. When user joins, they're added to:
   - Interest-based rooms (from signup)
   - Default rooms (general, random)
2. Users can see all connected users in the sidebar
3. Click any room to view/send messages in that room
4. Click any online user to start direct messaging

### Real-Time Features
- **Messages**: Sent via `socket.emit()`, received via `socket.on()`
- **Typing**: Broadcast when user types in message input
- **User Status**: Emit events when users join/leave
- **Auto-scroll**: Message container auto-scrolls to latest message

---

## 🎮 Usage Guide

### Login/Signup
```
1. Go to http://localhost:3000
2. Enter username and password
3. Click "Sign Up" to create new account
4. Select at least one interest
5. Click "Sign Up" button
6. You'll be redirected to chat
```

### Send Messages
```
1. Select a room from the sidebar
2. Type message in input field
3. Press Enter or click "Send" button
4. Message appears immediately for all users in that room
```

### Direct Messaging
```
1. Click an online user from the "Online Users" section
2. Or enter username in "Direct Message" input
3. Click "Chat" button
4. Private chat window opens
5. Send messages to that user only
```

### See Typing Indicator
```
1. When another user types in a room you're viewing
2. You'll see dots animation with "{username} is typing..."
3. Disappears after 2 seconds of no activity
```

---

## 🔧 Server Events

### Emitted Events (Client → Server)

| Event | Data | Purpose |
|-------|------|---------|
| `join` | `{username, userId, rooms}` | User joins chat |
| `chat message` | `{user, room, text, timestamp}` | Send group message |
| `private message` | `{from, to, text, timestamp}` | Send direct message |
| `typing` | `{user, room}` | Notify typing |
| `disconnect` | - | User leaves |

### Received Events (Server → Client)

| Event | Data | Purpose |
|-------|------|---------|
| `chat message` | `{user, room, text, timestamp}` | Receive group message |
| `private message` | `{from, to, text, timestamp}` | Receive direct message |
| `user joined` | `{username, userId, timestamp}` | User came online |
| `user left` | `{username, userId, timestamp}` | User went offline |
| `typing` | `{user, room}` | User is typing |

---

## 🌟 Key Code Examples

### Sending a Message
```javascript
socket.emit("chat message", {
    user: username,
    room: currentRoom,
    text: messageText,
    timestamp: new Date().toLocaleTimeString()
});
```

### Receiving Messages
```javascript
socket.on("chat message", (data) => {
    displayMessage(data);
});
```

### Starting Private Chat
```javascript
socket.emit("private message", {
    from: username,
    to: targetUser,
    text: messageText,
    timestamp: new Date().toLocaleTimeString()
});
```

---

## 🎨 Customization

### Change Colors
Edit `public/style.css`:
```css
/* Primary gradient colors */
--primary: #667eea;
--secondary: #764ba2;
```

### Add More Interests
Edit `public/index.html`:
```html
<label><input type="checkbox" value="your-interest"> Your Interest</label>
```

### Change Server Port
Edit `server.js`:
```javascript
const PORT = process.env.PORT || 3000; // Change 3000
```

### Modify Chat Rooms
Edit `server.js`:
```javascript
socket.join("your-room");
```

---

## 📊 Performance Considerations

- **Message Storage**: Currently stores in memory (browser session)
- **Scalability**: For production, use database (MongoDB, PostgreSQL)
- **Authentication**: Currently client-side (use bcrypt for production)
- **User Limit**: Test with up to 100+ concurrent users
- **Message Load**: Efficiently handles real-time message delivery

---

## 🔒 Security Notes

⚠️ **Current Implementation** (Development Only):
- Passwords not hashed (use bcrypt in production)
- No server-side session validation
- Messages not encrypted
- No rate limiting

✅ **For Production**:
- Hash passwords with bcrypt
- Implement JWT authentication
- Add database for message persistence
- Use HTTPS/WSS for encryption
- Add rate limiting
- Implement user roles and permissions
- Add message sanitization

---

## 🐛 Troubleshooting

### Server won't start
```
Error: Port 3000 already in use
→ Change PORT in server.js or kill process using port 3000
```

### Messages not appearing
```
→ Check if Socket.io is connected
→ Open browser console (F12) for errors
→ Ensure server is running
```

### Can't see other users
```
→ Make sure other users joined the same room
→ Check localStorage for username
→ Refresh page and try again
```

### Typing indicator not showing
```
→ Ensure you're in the same room as other user
→ Check network tab for socket events
```

---

## 📈 Future Enhancements

- [ ] Message persistence with database
- [ ] User authentication with JWT
- [ ] Password hashing and security
- [ ] Message search functionality
- [ ] File/image sharing
- [ ] Message reactions/emojis
- [ ] User profiles and bios
- [ ] Message editing and deletion
- [ ] Read receipts
- [ ] Voice/video calling
- [ ] Dark/light theme toggle
- [ ] Notification sound
- [ ] Mobile app version

---

## 📝 License

This project is open-source and available for educational and personal use.

---

## 👨‍💻 Contributing

Contributions are welcome! Feel free to:
1. Report bugs
2. Suggest new features
3. Submit pull requests
4. Improve documentation

---

## 📞 Support

For issues or questions:
1. Check the Troubleshooting section
2. Review Socket.io documentation: https://socket.io/docs/
3. Check browser console for errors (F12)
4. Review server logs in terminal

---

## 🎓 Learning Resources

This project demonstrates:
- **Real-time Communication**: Socket.io event handling
- **Event-Driven Architecture**: Client-server event patterns
- **DOM Manipulation**: Dynamic HTML updates with JavaScript
- **CSS3 Features**: Gradients, animations, flexbox
- **Express Server**: HTTP and WebSocket routing
- **localStorage API**: Client-side data persistence

Perfect for learning modern web development!

---

**Happy Chatting! 💬✨**
