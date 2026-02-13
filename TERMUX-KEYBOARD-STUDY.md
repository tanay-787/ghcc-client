# Termux Keyboard Approach - Study Notes

## Overview
Analysis of Termux's approach to custom terminal keyboards on mobile devices for implementing similar functionality in ghcc-client React Native app.

---

## Termux Architecture

### Key Components

**1. ExtraKeysView** (Custom Keyboard Toolbar)
- Located in: `termux-shared` repository
- Custom Android View that renders a toolbar above the system keyboard
- Provides terminal-specific keys: ESC, TAB, CTRL, ALT, arrow keys, etc.
- Fully customizable layout via configuration

**2. TermuxTerminalExtraKeys** (Client/Controller)
- File: `app/src/main/java/com/termux/app/terminal/io/TermuxTerminalExtraKeys.java`
- Handles key events from ExtraKeysView
- Sends key codes to TerminalSession
- Manages special key combinations (CTRL+C, CTRL+D, etc.)

**3. TerminalView** (Terminal Display)
- File: `terminal-view/src/main/java/com/termux/view/TerminalView.java`
- Renders the terminal using Android Canvas
- Handles touch gestures, text selection, scrolling
- Receives input from both system keyboard and ExtraKeysView

### How It Works

```
User taps "ESC" button
    ↓
ExtraKeysView captures touch event
    ↓
TermuxTerminalExtraKeys processes button press
    ↓
Sends KeyEvent to TerminalSession
    ↓
TerminalEmulator processes escape sequence
    ↓
TerminalView displays result
```

---

## Key Features

### 1. **Button Configuration**
Termux allows users to customize the extra keys toolbar via configuration:

```
# Example from termux.properties
extra-keys = [['ESC','/','-','HOME','UP','END','PGUP'],['TAB','CTRL','ALT','LEFT','DOWN','RIGHT','PGDN']]
```

This creates two rows of customizable keys.

### 2. **Key Combinations**
Supports modifier keys:
- **CTRL + Key**: Hold CTRL button, tap another key
- **ALT + Key**: Hold ALT button, tap another key
- **Sticky modifiers**: Tap CTRL/ALT once, next key gets modifier

### 3. **Special Keys Handled**
- **ESC**: `\u001b` (ASCII 27)
- **TAB**: `\t` (ASCII 9)
- **CTRL+C**: `\u0003` (ASCII 3)
- **CTRL+D**: `\u0004` (ASCII 4)
- **Arrow keys**: ANSI escape sequences
  - UP: `\u001b[A`
  - DOWN: `\u001b[B`
  - RIGHT: `\u001b[C`
  - LEFT: `\u001b[D`
- **Enter**: `\r` (carriage return, not `\n`)

### 4. **Gesture Support**
- **Long press on screen**: Select text mode
- **Two-finger pinch**: Zoom in/out (font size)
- **Swipe**: Scroll terminal history
- **Double tap**: No action (reserved for future)

---

## Architecture Diagram

```
┌─────────────────────────────────────────┐
│         TermuxActivity (Main UI)        │
└────────────────┬────────────────────────┘
                 │
        ┌────────┴───────┐
        │                │
┌───────▼───────┐  ┌────▼───────────────┐
│ ExtraKeysView │  │  TerminalView      │
│ (Toolbar)     │  │  (Terminal Display)│
└───────┬───────┘  └────┬───────────────┘
        │               │
        │    ┌──────────▼────────────┐
        └───►│ TerminalSession       │
             │ (Process I/O)         │
             └──────────┬────────────┘
                        │
             ┌──────────▼────────────┐
             │ TerminalEmulator      │
             │ (VT100 parsing)       │
             └───────────────────────┘
```

---

## Implementation for ghcc-client (React Native)

**LICENSE NOTE:** ghcc-client is licensed under GPLv3, making it compatible with Termux (also GPLv3). This means we can study Termux's implementation closely and adopt similar approaches while building our own code from scratch.

### Option 1: Custom Toolbar Component (Recommended)

```jsx
// KeyboardToolbar.tsx
import React from 'react';
import { View, TouchableOpacity, Text, StyleSheet } from 'react-native';

const KeyboardToolbar = ({ webViewRef }) => {
  const sendKey = (keyCode) => {
    webViewRef.current?.injectJavaScript(`
      // Inject key into ttyd terminal
      if (window.term && window.term.send) {
        window.term.send('${keyCode}');
      }
      true;
    `);
  };

  return (
    <View style={styles.toolbar}>
      <TouchableOpacity onPress={() => sendKey('\\u001b')}>
        <Text style={styles.key}>ESC</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={() => sendKey('\\t')}>
        <Text style={styles.key}>TAB</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={() => sendKey('\\u001b[A')}>
        <Text style={styles.key}>↑</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={() => sendKey('\\u001b[B')}>
        <Text style={styles.key}>↓</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={() => sendKey('\\u001b[D')}>
        <Text style={styles.key}>←</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={() => sendKey('\\u001b[C')}>
        <Text style={styles.key}>→</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={() => sendKey('\\u0003')}>
        <Text style={styles.key}>CTRL+C</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={() => sendKey('\\r')}>
        <Text style={styles.key}>↵</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  toolbar: {
    flexDirection: 'row',
    backgroundColor: '#2e2e2e',
    padding: 4,
    borderTopWidth: 1,
    borderTopColor: '#3e3e3e',
  },
  key: {
    flex: 1,
    color: '#d4d4d4',
    textAlign: 'center',
    padding: 8,
    backgroundColor: '#3e3e3e',
    marginHorizontal: 2,
    borderRadius: 3,
  },
});

export default KeyboardToolbar;
```

### Usage in App

```jsx
// App.tsx
import { WebView } from 'react-native-webview';
import KeyboardToolbar from './KeyboardToolbar';

const App = () => {
  const webViewRef = useRef(null);

  return (
    <View style={{ flex: 1 }}>
      <WebView
        ref={webViewRef}
        source={{ uri: 'http://localhost:7681' }}
        // ... other props
      />
      <KeyboardToolbar webViewRef={webViewRef} />
    </View>
  );
};
```

---

## Key Insights from Termux

### 1. **Layout Flexibility**
Termux allows multi-row toolbars with customizable keys. Users can:
- Add/remove keys
- Reorder keys
- Create shortcuts for common commands

### 2. **Modifier Key State**
Termux maintains state for modifier keys (CTRL, ALT):
- **Toggle mode**: Tap once, next key gets modifier, then resets
- **Hold mode**: Long press, all taps get modifier until released

### 3. **Performance Optimization**
- Keys are rendered as simple Views/Buttons (not WebView)
- Native touch events (no JavaScript delay)
- Direct communication with terminal session

### 4. **Accessibility**
- Large touch targets (48dp minimum)
- Clear visual feedback on press
- Haptic feedback on long press

---

## Differences: Termux vs ghcc-client

| Aspect | Termux | ghcc-client |
|--------|--------|-------------|
| Terminal | Native Android TerminalView | ttyd in WebView |
| Input handling | Direct KeyEvent → TerminalSession | JavaScript injection → ttyd |
| Architecture | Native Android app | React Native + WebView |
| Key sending | `terminal.send(keyCode)` | `webView.injectJavaScript()` |
| Customization | termux.properties file | React Native state/props |
| License | GPLv3 (can study, not copy) | Custom (build from scratch) |

---

## Challenges for ghcc-client

### 1. **WebView Communication Delay**
- Termux: Direct native call (< 1ms)
- ghcc-client: JavaScript injection (10-50ms potential delay)
- **Solution**: Pre-inject JavaScript bridge for faster communication

### 2. **Terminal Access**
- Termux: Owns the terminal emulator
- ghcc-client: ttyd is third-party, need to find how it exposes terminal
- **Solution**: Research ttyd's JavaScript API (`window.term`)

### 3. **Cross-Platform**
- Termux: Android only
- ghcc-client: iOS + Android
- **Solution**: Use React Native's platform-agnostic components

---

## Licensing Decision: GPLv3 Open Source ✅

**ghcc-client is now licensed under GPLv3**, making it:
- ✅ **Compatible** with Termux (also GPLv3)
- ✅ **Open source** - all code publicly available
- ✅ **Community-driven** - anyone can contribute
- ✅ **Educational** - others can learn from the implementation
- ✅ **Free** - no licensing fees or restrictions

**What this means:**
- We can study Termux's implementation closely
- We can adopt proven patterns and architectures
- We must share all modifications publicly
- Others can use, modify, and distribute ghcc-client freely
- Any forks must also be GPLv3

---

## Next Steps

1. **Test ttyd JavaScript API**
   - Inject code to check if `window.term` exists
   - Test `window.term.send()` or equivalent
   - Check ttyd documentation for API

2. **Prototype Toolbar**
   - Build basic toolbar with ESC, TAB, arrows
   - Test latency of JavaScript injection
   - Measure user experience

3. **Advanced Features** (Phase 2)
   - Modifier key state (CTRL/ALT toggle)
   - Customizable layouts
   - Gesture shortcuts
   - Haptic feedback

4. **Alternative: Browser-Based Toolbar** (Phase 1)
   - Inject HTML toolbar into ttyd-base.html
   - Use native JavaScript (no WebView bridge needed)
   - Test on mobile browsers first

---

## Resources

- **Termux GitHub**: https://github.com/termux/termux-app
- **Termux Terminal View**: https://github.com/termux/termux-app/tree/master/terminal-view
- **Termux Extra Keys**: Search `ExtraKeysView` in termux-shared repo
- **xterm.js Docs**: https://xtermjs.org/docs/api/
- **ttyd GitHub**: https://github.com/tsl0922/ttyd

---

## Conclusion

**Termux's approach is battle-tested and proven effective.** The key takeaway:
- **Simple button toolbar** above keyboard
- **Direct key injection** into terminal
- **Customizable layout** for user preferences

For ghcc-client (GPLv3 Open Source):
- **Phase 1** (Browser): Inject HTML toolbar in ttyd-base.html
- **Phase 2** (RN App): Build React Native toolbar with WebView bridge
- **Benefit**: Can study and adopt Termux patterns while building our own code
- **Community**: Open for contributions and improvements

Both approaches are feasible. The RN approach gives more control and native feel.

---

**License:** This project is licensed under GPLv3, compatible with Termux and other terminal emulators in the ecosystem.
