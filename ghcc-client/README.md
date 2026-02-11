# ghcc-client

**GitHub Copilot CLI Remote Client** - Access your GitHub Copilot CLI session from anywhere - mobile, browser, or terminal.

[![npm version](https://img.shields.io/npm/v/ghcc-client.svg)](https://www.npmjs.com/package/ghcc-client)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## ✨ Features

- 🌐 **Remote Access** - Control Copilot CLI from your phone, tablet, or any browser
- 🔄 **Session Continuity** - Start on desktop, continue on mobile, same conversation
- 📱 **Mobile Friendly** - Full terminal access optimized for mobile browsers
- 🚀 **Easy Setup** - One command to start, zero configuration needed
- 🔒 **Secure** - Runs locally, your code stays private

## 🎯 Use Cases

- Code from your phone while away from desk
- Continue Copilot conversations across devices
- Demo Copilot to others remotely
- Access development environment from anywhere

## 📦 Installation

### Platform Support

- ✅ **Linux** (Ubuntu, Debian, Fedora, Arch, etc.)
- ✅ **macOS** (Intel & Apple Silicon)
- ⚠️ **Windows** via WSL2 (see below)

### Windows Users: Install WSL2 First

ghcc-client requires WSL2 (Windows Subsystem for Linux) on Windows.

**Quick WSL2 Installation:**

```powershell
# Open PowerShell as Administrator and run:
wsl --install

# Restart your computer
```

**Official Guide:** [Microsoft WSL Installation Guide](https://docs.microsoft.com/en-us/windows/wsl/install)

**After WSL2 is installed:**

```bash
# Open WSL terminal (Ubuntu) and install ghcc-client:
wsl
npm install -g ghcc-client

# Use it normally - access from Windows browser works!
ghcc-client start
# Then open: http://localhost:7681 in your Windows browser
```

**Why WSL2?** ttyd and tmux require Unix/Linux environment. WSL2 provides full Linux compatibility on Windows.

---

### Option 1: npm (Recommended)

```bash
npm install -g ghcc-client
```

### Option 2: From GitHub Release

```bash
npm install -g https://github.com/YOUR_USERNAME/ghcc-client/releases/download/v1.0.0/ghcc-client-1.0.0.tgz
```

### Option 3: Install Script

```bash
curl -fsSL https://raw.githubusercontent.com/YOUR_USERNAME/ghcc-client/main/install.sh | bash
```

## 🚀 Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) 14 or higher
- [GitHub Copilot CLI](https://www.npmjs.com/package/@github/copilot) installed
- [tmux](https://github.com/tmux/tmux) (usually pre-installed on Linux/Mac)

### Start Remote Session

```bash
ghcc-client start
```

Output:
```
🚀 Starting GitHub Copilot Remote Session...

✔ Copilot CLI found
✔ Copilot started in tmux session "copilot-remote"
✔ ttyd server started on port 7681

✅ Remote session is ready!

Access URLs:
  Desktop Browser: http://localhost:7681
  Mobile Browser:  http://10.88.0.3:7681
  Session Name:    copilot-remote

💡 Tip: Use "ghcc-client url" to see these URLs again
```

### First Time Setup

When you first connect via browser, login using the interactive command:

```bash
# Inside the browser terminal:
/login
```

Follow the OAuth flow to authenticate with GitHub.

### Session Management

Use Copilot's built-in commands in the browser terminal:

```bash
/resume        # Switch between your sessions
/clear         # Start a fresh conversation
/model         # Change AI model
/help          # See all available commands
```

### Access from Mobile

1. Note the "Mobile Browser" URL from output
2. Open that URL on your phone
3. You'll see the Copilot CLI terminal
4. Type and interact just like on desktop!

## 📖 Commands

### `ghcc-client start`

Start a remote Copilot session

```bash
ghcc-client start                    # Default: port 7681, session "copilot-remote"
ghcc-client start -p 8080            # Custom port
ghcc-client start -s my-session      # Custom session name
```

**Options:**
- `-p, --port <port>` - Port for remote access (default: 7681)
- `-s, --session <name>` - tmux session name (default: copilot-remote)

### `ghcc-client stop`

Stop the remote session

```bash
ghcc-client stop                     # Stop default session
ghcc-client stop -s my-session       # Stop specific session
```

### `ghcc-client status`

Check session status

```bash
ghcc-client status
```

Output:
```
📊 Session Status

✅ tmux session "copilot-remote" is running
   Started: 2/11/2026, 11:30:00 AM
✅ ttyd server is running
   Port: 7681
```

### `ghcc-client url`

Show access URLs

```bash
ghcc-client url                      # Default port 7681
ghcc-client url -p 8080              # Custom port
```

---

## 🔧 How It Works

```
┌──────────────────────────────────────────┐
│  Your Computer                           │
│  ┌────────────────────────────────────┐  │
│  │  tmux Session                      │  │
│  │  ┌──────────────────────────────┐  │  │
│  │  │  Copilot CLI                 │  │  │
│  │  │  (running and persistent)    │  │  │
│  │  └──────────────────────────────┘  │  │
│  └────────────────────────────────────┘  │
│         ▲                       ▲         │
│         │                       │         │
│  [Desktop Terminal]      [ttyd Server]   │
│   tmux attach              Port 7681      │
└──────────────────────────────┼────────────┘
                               │
                          WebSocket
                               │
                  ┌────────────┴────────────┐
                  │                         │
            [Mobile Browser]          [Desktop Browser]
```

**Components:**

1. **tmux** - Keeps Copilot CLI session running persistently
2. **ttyd** - Exposes terminal over WebSocket for browser access
3. **ghcc-client** - Manages everything with simple commands

**Why this works:**
- tmux keeps session alive even when disconnected
- Multiple clients can connect to same session
- All changes sync in real-time across devices

## 🎨 Usage Examples

### Work on the Go

```bash
# At desk: Start session
ghcc-client start

# Step away, pull out phone
# Open: http://YOUR_IP:7681
# Continue conversation from phone - full session continuity!
```

### Multiple Devices

```bash
# Desktop browser: http://localhost:7681
# Mobile browser: http://IP:7681
# Terminal: tmux attach -t copilot-remote

# All three see the SAME session!
# Type on any device, others update instantly
```

### Demo/Pair Programming

```bash
# Start session
ghcc-client start

# Share URL with colleague
# They can watch (read-only) or participate

# Everyone sees same Copilot responses
```

## 🔐 Security

⚠️ **Current version has NO authentication!**

The ttyd server is accessible to anyone on your network. For production use:

### Add Authentication

Authentication requires modifying the compiled code or using a reverse proxy.

**Option 1: Use ttyd authentication (requires building from source)**

**Option 2: Reverse Proxy (Recommended)**

Use nginx or caddy with authentication:

```nginx
# nginx config
location / {
    auth_basic "Restricted";
    auth_basic_user_file /etc/nginx/.htpasswd;
    proxy_pass http://localhost:7681;
}
```

### Use SSH Tunnel (Recommended)

Instead of exposing port directly:

```bash
# On server
ghcc-client start

# On client (your phone via SSH)
ssh -L 7681:localhost:7681 user@server

# Then access: http://localhost:7681 on phone
```

### Firewall

Only allow connections from specific IPs:

```bash
# Linux
sudo ufw allow from 192.168.1.0/24 to any port 7681
```

## 🐛 Troubleshooting

### Windows: "Platform not supported"

You need WSL2! See installation section above.

**Quick fix:**
```powershell
# PowerShell as Administrator
wsl --install
# Restart computer, then install in WSL
```

### "Copilot CLI not found"

Install GitHub Copilot CLI:

```bash
npm install -g @github/copilot
```

### "tmux not found"

Install tmux:

```bash
# Ubuntu/Debian/WSL
sudo apt-get install tmux

# macOS
brew install tmux
```

### "Port already in use"

Use a different port:

```bash
ghcc-client start -p 8080
```

### Can't connect from mobile

1. Check firewall allows port 7681
2. Ensure mobile is on same network
3. Try IP address instead of hostname
4. Check with: `curl http://localhost:7681` on server
5. **Windows/WSL:** Make sure you're using the WSL IP, not Windows IP

### Session keeps dying

Check tmux session status and logs:

```bash
ghcc-client status
tmux attach -t copilot-remote  # See Copilot error messages directly
```

### WSL2 specific issues

**Can't access from Windows browser:**
```bash
# In WSL, check your IP:
ip addr show eth0 | grep inet

# Use that IP in Windows browser:
# http://WSL_IP:7681
```

**Or use localhost (Windows 11+):**
```
http://localhost:7681
```

## 📱 Mobile App Integration

For a native mobile app, use React Native WebView:

```javascript
import { WebView } from 'react-native-webview';

export default function App() {
  return (
    <WebView 
      source={{ uri: 'http://YOUR_SERVER_IP:7681' }}
      style={{ flex: 1 }}
    />
  );
}
```

## 🤝 Contributing

Contributions welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) first.

### Development

This project is written in **TypeScript** for type safety and better developer experience.

**Setup:**

```bash
git clone https://github.com/YOUR_USERNAME/ghcc-client.git
cd ghcc-client
npm install
```

**Build:**

```bash
npm run build        # Compile TypeScript to JavaScript
npm run dev          # Watch mode (auto-rebuild on changes)
npm run clean        # Clean dist/ folder
```

**Local testing:**

```bash
npm link             # Link package globally
ghcc-client start    # Test your changes
npm unlink           # Unlink when done
```

**Project structure:**

```
ghcc-client/
├── src/                      # TypeScript source
│   ├── cli.ts               # CLI commands
│   ├── session-manager.ts   # Core logic
│   ├── types.ts             # TypeScript interfaces
│   └── setup.ts             # Post-install script
├── dist/                    # Compiled JavaScript (git ignored)
├── binaries/                # ttyd binaries for each platform
└── package.json
```

## 📝 License

MIT © [Your Name]

## 🙏 Credits

- [ttyd](https://github.com/tsl0922/ttyd) - Awesome terminal over WebSocket
- [tmux](https://github.com/tmux/tmux) - Terminal multiplexer
- [GitHub Copilot CLI](https://github.com/github/copilot-cli) - AI pair programmer

## 📮 Support

- 🐛 [Report bugs](https://github.com/YOUR_USERNAME/ghcc-client/issues)
- 💡 [Request features](https://github.com/YOUR_USERNAME/ghcc-client/issues)
- 💬 [Discussions](https://github.com/YOUR_USERNAME/ghcc-client/discussions)

---

**Made with ❤️ for remote coding**
