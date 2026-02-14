# GhCC-Client

A Node.js CLI utility tool that allows its users to remotely interact with a GitHub Copilot CLI session from their mobiles, tablets and any other devices that support web-browsers.

## Features

- **Persistent Copilot sessions** — Runs Copilot CLI inside tmux so your session survives disconnects, terminal closures, and even host reboots
- **Browser-based terminal** — Uses ttyd to expose the tmux session as a web interface compatible with mobile and desktop browsers
- **Native keyboard toolbar UI** — Custom mobile keyboard toolbar components inspired by Termux app, providing quick access to common terminal shortcuts (Ctrl, Alt, Tab, arrow keys, etc.) for seamless mobile interactions
- **Portrait-based resizing** — Automatically adapts terminal layout for portrait and landscape orientations, optimizing readability on mobile devices
- **Public tunneling** — Optional localtunnel integration creates temporary public URLs with QR codes for quick mobile access

## Requirements

Before using ghcc-client, ensure the following are installed and configured:

### 1. Node.js 14.0 or newer

**Install from:** [https://nodejs.org/](https://nodejs.org/)

### 2. tmux (Terminal Multiplexer)

**Official docs:** [https://github.com/tmux/tmux/wiki](https://github.com/tmux/tmux/wiki)

Required for persistent Copilot sessions that survive disconnects, terminal closures, and reboots.

- **Linux:** Available in default repos. Install with your package manager (apt, dnf, pacman, etc.)
- **macOS:** Pre-installed or available via Homebrew
- **Windows:** Requires WSL2 (see point 5)


### 3. GitHub Copilot CLI

**Install from:** [https://github.com/github/copilot-cli](https://github.com/github/copilot-cli)

```bash
npm install -g @github/copilot
```

**Authentication (Recommended):**
While you *can* authenticate directly within your ghcc-client session, it's recommended to authenticate beforehand for better security and reliability:

```bash
copilot login
```

### 4. ttyd (Web Terminal)

**Good news:** ttyd binaries are bundled with ghcc-client for your operating system, so no separate installation needed.

**Official docs:** [https://github.com/tsl0922/ttyd](https://github.com/tsl0922/ttyd)

### 5. Windows Users: WSL2 Required

On Windows, tmux is not supported by default and is available via **WSL2 (Windows Subsystem for Linux 2)**.

**Quick setup:**

```powershell
# PowerShell as Administrator
wsl --install
```

Then install in WSL:
```bash
sudo apt-get update
sudo apt-get install nodejs npm tmux
npm install -g ghcc-client
```

**Official guide for WSL:** [https://learn.microsoft.com/en-us/windows/wsl/install](https://learn.microsoft.com/en-us/windows/wsl/install)

## Installation

### From npm (Recommended)

```bash
npm install -g ghcc-client
```

### From source

```bash
git clone https://github.com/tanay-787/ghcc-client.git
cd ghcc-client
npm install
npm run build
npm link   # Optional: make CLI available globally for testing
```

## Getting Started

### 1. Start a session

```bash
# Start with auto-assigned port
ghcc-client

# Or specify a port
ghcc-client -p 7681
```

### 2. Access from browser

Open the Access URLs in any browser. The output will show:
- Local address: `http://localhost:7681` (or your chosen port)
- Public URL: if tunneling is enabled (scan the QR code for easier mobile access)

### 3. Stop the session

Press `Ctrl+C` to stop, or use `/quit` command inside the Copilot CLI session.

## CLI Reference

```
ghcc-client [options]

Options:
  -p, --port <port>    Specify port for ttyd (default: auto-assign)
  --help               Display help and exit
  --public             Use localtunnel to generate public access URLs
```

## How It Works

ghcc-client orchestrates three core components:

| Component | Role |
|-----------|------|
| **tmux** | Terminal multiplexer that keeps the Copilot session alive and persistent |
| **ttyd** | WebSocket-based terminal server that exposes tmux to HTTP clients |
| **localtunnel** (optional) | Creates temporary public URLs for remote browser access with QR codes |

The workflow:
1. ghcc-client spawns a tmux session and launches Copilot CLI within it
2. ttyd binds to the specified port and serves the tmux session over HTTP/WebSocket
3. Any browser can connect and interact with the terminal
4. The session remains alive even if the browser disconnects or closes
5. Optional public tunneling allows access from outside your local network


## Security Considerations

**Public tunnels expose your terminal to the internet.** Review these practices:

- Treat all data visible in a publicly tunneled session as potentially visible to anyone with the URL
- Never expose secrets, API keys, or sensitive credentials in a public session
- Review firewall and network access control policies before enabling public tunnels
- Localtunnel URLs are temporary and expire when the session ends

For sensitive operations, always use a local connection (`http://localhost:PORT`) or a private network.

## Troubleshooting

### Common issues and solutions

| Issue | Solution |
|-------|----------|
| **"Copilot CLI not found"** | Install and authenticate: `npm install -g @github/copilot && copilot auth login` |
| **"tmux not found"** | Install tmux: `brew install tmux` (macOS) or `sudo apt-get install tmux` (Linux/WSL) |
| **"ttyd binary not found"** | Reinstall the package or manually place the correct ttyd binary in `binaries/` |
| **"Port already in use"** | Use a different port: `ghcc-client -p 8080` or stop the conflicting service |
| **Windows: Cannot connect** | Ensure you're running inside WSL2 and accessing via WSL IP or `localhost` from WSL |

### Enable debug logging

If you encounter issues, check the terminal output for error messages. The client will report failures during startup.

## Development

### Local setup

```bash
# Clone and install dependencies
git clone https://github.com/tanay-787/ghcc-client.git
cd ghcc-client
npm install

# Build the project
npm run build

# Link for local testing
npm link
ghcc-client

# Unlink when finished
npm unlink
```

### Project structure

```
ghcc-client/
├── src/              # TypeScript source code
├── dist/             # Compiled JavaScript output
├── assets/           # Static HTML/CSS for browser interface
├── binaries/         # Platform-specific ttyd executables
├── package.json      # Dependencies and build scripts
├── tsconfig.json     # TypeScript configuration
└── README.md         # This file
```

## Contributing

We welcome contributions! Please follow these steps:

1. **Discuss larger changes** — Open an issue to discuss your idea before implementing
2. **Create a feature branch** — `git checkout -b feature/your-feature-name`
3. **Implement and test** — Write code, test thoroughly, and verify no regressions
4. **Open a pull request** — Include a clear description of the problem and solution
5. **Provide testing steps** — Help reviewers understand how to test your changes

### Development setup

- Run `npm install` to install dependencies.
- Run `npm run build` to compile TypeScript sources.
- If you want to set up the binaries (as the postinstall step would), run `npm run postinstall` manually after building.
- Note: The postinstall script is only triggered automatically when installing from npm (not from source).

For bug reports, include:
- Steps to reproduce
- Expected vs. actual behavior
- Your environment (OS, Node.js version, Copilot CLI version)

## License

This project is licensed under the **GNU General Public License v3.0** (GPL-3.0).

See the [LICENSE](./LICENSE) file for full details.

```
Copyright (c) 2026 All rights reserved - Licensed under GPL-3.0
```

## Dependencies

This project relies on the following third-party components:

| Component | Purpose |
|-----------|---------|
| **ttyd** | Terminal-to-web server using WebSockets and HTTP |
| **tmux** | Session persistence and terminal multiplexing |
| **localtunnel** | Optional public URL and tunneling for remote access |
| **qrcode-terminal** | QR code generation for mobile access links |

## Support & Feedback

- **GitHub Profile:** [tanay-787](https://github.com/tanay-787)
- **Bug reports & features:** [Issue tracker](https://github.com/tanay-787/ghcc-client/issues)
- **General discussion:** [Discussions](https://github.com/tanay-787/ghcc-client/discussions)
- **Security concerns:** See [SECURITY.md](./SECURITY.md)

Have questions or ideas? Open an issue—we're here to help!

---

**Co-authored by:** Tanay Gupte & GitHub Copilot CLI  
**Last updated:** 2026 | Built with TypeScript and Node.js
