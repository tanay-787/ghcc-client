# Security Model

## Overview

`ghcc-client` provides remote browser access to GitHub Copilot CLI sessions. This document describes the security measures implemented to protect your terminal sessions and credentials.

## Security Features

### 1. **Multi-Layer Authentication**

#### ttyd Basic Authentication
- Every terminal session is protected with HTTP Basic Authentication
- Username: `user`
- Password: Randomly generated **6-character** base64 string
- Password is displayed **once** during session start and must be saved
- No session can be accessed without this password
- **Mobile-friendly**: Easy to type on mobile keyboards vs 32-char passwords
- **Security**: 6 base64 chars = 68.7 billion combinations (base64 alphabet: A-Z, a-z, 0-9, +, /)

#### Localtunnel IP-based Access Control
- Public URLs (via localtunnel) require additional tunnel password
- Password is the server's public IP address
- Visitors authenticate once per IP address
- Valid for 7 days after successful authentication

### 2. **HTTPS/TLS Encryption**

#### Self-Signed Certificates
- ttyd serves over HTTPS using self-signed certificates
- Certificates are auto-generated on first run
- Stored in `~/.ghcc-client/certs/` with 0600 permissions (owner-only read/write)
- Valid for 365 days

#### Certificate Locations
```
~/.ghcc-client/certs/cert.pem  (0600)
~/.ghcc-client/certs/key.pem   (0600)
```

**Note:** Browsers will show a security warning for self-signed certificates. This is expected - click "Advanced" and "Proceed" to continue. The connection is encrypted but not verified by a Certificate Authority.

#### Fallback to HTTP
- If OpenSSL is not installed, ttyd falls back to HTTP
- A warning is displayed during startup
- Install `openssl` for secure HTTPS connections

### 3. **Input Validation**

#### Session Names
- Must be 3-64 characters long
- Must start with letter or number
- Only alphanumeric characters, hyphens, and underscores allowed
- Pattern: `/^[a-zA-Z0-9][a-zA-Z0-9_-]{2,63}$/`
- Prevents command injection attacks

#### Port Numbers
- Must be in range 1024-65535 (non-privileged ports)
- Prevents binding to system ports (< 1024)
- Strict integer validation (no decimals, negatives, or overflow)

### 4. **File System Security**

#### Secure Temporary Files
- All temp files created in isolated directories with 0700 permissions
- Files have 0600 permissions (owner read/write only)
- No world-readable data
- Uses `fs.mkdtempSync()` for atomic directory creation
- Prevents symlink attacks and race conditions

#### Temp File Locations
```
/tmp/ghcc-<session>-XXXXXX/file.html     (0600 in 0700 directory)
~/.ghcc-client/certs/*.pem               (0600)
```

### 5. **Process Isolation**

- Each session runs in isolated tmux session
- ttyd spawned as detached process
- Process cleanup on session termination
- Automatic cleanup of orphaned processes

### 6. **Network Security**

#### Local Access
- Binds to all interfaces (0.0.0.0) for network access
- Protected by authentication even on local network
- HTTPS encryption for all traffic

#### Public Access (Localtunnel)
- Optional public URL via localtunnel
- Two-factor authentication (tunnel password + ttyd password)
- IP-based access control (7-day validity per IP)
- Tunnel password displayed during startup

## Threat Model

### What We Protect Against

✅ **Unauthenticated Access**
- Random strong passwords (32 chars, base64)
- No default or weak passwords
- Basic authentication on every request

✅ **Command Injection**
- Strict input validation
- Whitelist-based session name filtering
- Safe port number validation

✅ **Network Eavesdropping**
- HTTPS/TLS encryption
- All credentials transmitted over encrypted channel

✅ **File System Attacks**
- Secure temp file creation
- Restrictive permissions (0600/0700)
- No world-readable sensitive data

✅ **Session Hijacking**
- Unique random passwords per session
- Password not stored (displayed once only)
- HTTPS prevents credential interception

### Limitations

⚠️ **Self-Signed Certificates**
- Browser security warnings (expected)
- Not verified by Certificate Authority
- Protects against passive eavesdropping
- Does NOT protect against active MITM with certificate substitution

⚠️ **Shared System Access**
- If attacker has shell access on same machine, they can:
  - Kill your ttyd/tmux processes
  - See your processes in `ps` output
  - Access home directory if permissions allow
- **Mitigation:** Run on trusted servers only, use proper system-level access controls

⚠️ **Localtunnel Trust**
- Public URLs rely on localtunnel service (loca.lt)
- Service availability not guaranteed
- Consider self-hosting alternative (ngrok, frp) for production

⚠️ **Password Display**
- Password shown in terminal output during startup
- If terminal history is logged, password may be recorded
- **Mitigation:** Clear terminal history after noting password

⚠️ **No Rate Limiting**
- Authentication attempts not rate-limited
- Brute force attacks possible (but impractical with 32-char passwords)
- **Mitigation:** Use strong passwords (default), monitor failed auth attempts

## Best Practices

### For Users

1. **Save Your Password Securely**
   - Password is shown once during session start
   - Store in password manager (not plain text file)
   - Required for every browser access

2. **Use HTTPS**
   - Install `openssl` if not present
   - Accept browser security warning for self-signed cert
   - Verify you're on your expected URL

3. **Trust Your Network**
   - Local network access means anyone on LAN can attempt to connect
   - They still need password, but traffic is visible
   - Use private networks or VPN when possible

4. **Limit Public Access**
   - Localtunnel URLs are public but require two passwords
   - Share tunnel password only with trusted users
   - Share ttyd password separately and securely

5. **Clean Up Sessions**
   - Stop sessions when done (`Ctrl+C`)
   - Verify cleanup with `ghcc-client status`
   - Passwords become invalid when session ends

6. **Monitor Access**
   - Check tmux session list: `tmux ls`
   - Check ttyd processes: `ps aux | grep ttyd`
   - Look for unexpected sessions

### For Developers

1. **Keep Dependencies Updated**
   ```bash
   npm audit
   npm update
   ```

2. **Review Security Updates**
   - Monitor ttyd releases
   - Check localtunnel security advisories
   - Update binaries when security fixes are available

3. **File Permissions**
   - Never weaken temp file permissions
   - Maintain 0600 for sensitive files
   - Use `fs.mkdtempSync()` for atomic creation

4. **Input Validation**
   - Always validate session names
   - Always validate port numbers
   - Never concatenate user input into shell commands
   - Use `execFile()` instead of `exec()` where possible

## Responsible Disclosure

If you discover a security vulnerability in ghcc-client:

1. **Do NOT** open a public GitHub issue
2. Email security details to: [YOUR_EMAIL]
3. Include:
   - Description of vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

We will respond within 48 hours and work with you to address the issue.

## Security Checklist

Before using ghcc-client in production:

- [ ] OpenSSL installed for HTTPS support
- [ ] Strong password noted and stored securely
- [ ] Running on trusted network or server
- [ ] Understanding of localtunnel security model
- [ ] Session cleanup procedure in place
- [ ] Monitoring plan for active sessions
- [ ] All dependencies up to date (`npm audit`)

## License

This security documentation is part of ghcc-client and licensed under GPLv3.
