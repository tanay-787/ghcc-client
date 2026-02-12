# ttyd Setup & Customization

## Key Discovery: Custom HTML vs Built-in Client

### ❌ What DOESN'T Work:
Using `-I custom.html` to provide custom HTML template breaks the terminal because:
- ttyd's default HTML is a **713KB bundled single-page app**
- It includes xterm.js, WebSocket client, and all connection logic
- When you use `-I`, ttyd serves YOUR HTML instead
- YOUR HTML doesn't have the terminal client code → "Connecting..." forever → 504 error

### ✅ What DOES Work:
Use ttyd's **client options** (`-t` flag) to customize:
- Title: `-t titleFixed="Your Title"`
- Font: `-t fontSize=14 -t fontFamily=Consolas`
- Theme: `-t theme='{"background":"#1e1e1e","foreground":"#d4d4d4"}'`
- Behavior: `-t disableLeaveAlert=true`

## Current Implementation

```bash
ttyd \
  -p 7681 \
  -W \
  -t fontSize=14 \
  -t fontFamily="Consolas,Monaco,Courier New,monospace" \
  -t theme='{"background":"#1e1e1e","foreground":"#d4d4d4","cursor":"#d4d4d4","selection":"#264f78"}' \
  -t titleFixed="GitHub Copilot - session-name" \
  -t disableLeaveAlert=true \
  -t disableResizeOverlay=true \
  tmux attach -t session-name
```

## Mobile Support

**Good news**: ttyd's built-in HTML already has excellent mobile support!
- Responsive viewport meta tag
- Touch-optimized terminal
- Portrait/landscape handling
- No custom HTML needed

Test it by visiting the URL on your phone - it works great out of the box.

## Available Client Options

Common `-t` options you can use:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `fontSize` | number | 13 | Terminal font size |
| `fontFamily` | string | - | Terminal font family |
| `theme` | JSON | - | Terminal colors (background, foreground, cursor, etc) |
| `titleFixed` | string | - | Fixed window title (overrides dynamic title) |
| `disableLeaveAlert` | boolean | false | Disable "are you sure?" on page leave |
| `disableResizeOverlay` | boolean | false | Disable terminal resize overlay |
| `enableZmodem` | boolean | false | Enable ZMODEM file transfer |
| `enableTrzsz` | boolean | false | Enable trzsz file transfer |

## Why This Approach is Better

1. **Actually works** - Terminal connects and functions properly
2. **Mobile optimized** - ttyd's built-in HTML is already mobile-ready
3. **Maintained** - Updates to ttyd improve our terminal automatically
4. **Lightweight** - No custom HTML to maintain
5. **Customizable** - Title, theme, font all configurable via options

## React Native Integration (Phase 2)

For the React Native app, we'll use WebView with ttyd's built-in HTML:

```typescript
<WebView
  source={{ uri: publicUrl }}
  // ttyd's HTML already mobile-optimized!
  // Optional: inject JS for app-specific features
  injectedJavaScript={`
    // Add custom keyboard toolbar
    // Handle copy/paste for mobile
    // etc.
  `}
/>
```

The built-in HTML is the perfect foundation for mobile apps.
