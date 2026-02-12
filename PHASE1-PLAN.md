# Phase 1: Mobile-Optimized Browser Experience

## Goals:
1. ✅ Custom page title (not raw tmux command)
2. ✅ Custom favicon (GitHub logo)
3. ✅ Mobile viewport (responsive layout)
4. ✅ Portrait/landscape support
5. ✅ Auto-resize terminal

## Implementation Steps:

### Step 1: Create Custom HTML Template
- File: `ghcc-client/assets/terminal.html`
- Features:
  - Mobile viewport meta tag
  - Custom title placeholder: {{SESSION_NAME}}
  - GitHub Copilot favicon (data URI)
  - Responsive CSS for portrait/landscape
  - Auto-fit terminal on resize
  - Touch-optimized terminal

### Step 2: Modify SessionManager
- Load HTML template on start
- Replace {{SESSION_NAME}} with actual session
- Write to /tmp/ghcc-SESSION.html
- Pass to ttyd: `-I /tmp/ghcc-SESSION.html`
- Add client options: `-t fontSize=14`

### Step 3: Test
- Start session
- Check title shows "GitHub Copilot - session-name"
- Test mobile viewport (responsive)
- Test portrait/landscape
- Test auto-resize

## Technical Details:

### ttyd Command:
```bash
ttyd -p PORT \
     -W \
     -I /tmp/ghcc-SESSION.html \
     -t fontSize=14 \
     -t theme='{"background":"#1e1e1e","foreground":"#d4d4d4"}' \
     tmux attach -t SESSION
```

### HTML Structure:
- Based on ttyd's xterm.js terminal
- Custom viewport for mobile
- CSS media queries
- Terminal auto-fit logic

Let's build it!
