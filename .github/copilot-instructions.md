# Copilot Instructions for ghcc-client

## Build, Test, and Lint Commands

- **Build:**
  - `npm run build` — Compiles TypeScript sources and copies assets
- **Development (watch mode):**
  - `npm run dev` — Rebuilds on file changes
- **Clean:**
  - `npm run clean` — Removes the `dist/` directory
- **Test:**
  - No automated tests are currently defined (see `package.json`)
- **Lint:**
  - No explicit lint command is defined

## How to Run a Single Test
- No test suite is present. Add tests and update this section if/when implemented.

## High-Level Architecture

- **Purpose:** Exposes a GitHub Copilot CLI session to any browser (especially mobile) via a secure web terminal.
- **Core Components:**
  - **CLI Entrypoint (`src/cli.ts`):** Handles command-line options, session creation, and cleanup.
  - **Session Manager (`src/session-manager.ts`):** Orchestrates tmux, ttyd, and (optionally) localtunnel for public access. Handles process management, port assignment, and security (auth, HTTPS, cleanup).
  - **Setup Script (`src/setup.ts`):** Ensures the correct ttyd binary is available and executable for the current platform.
  - **Type Definitions (`src/types.ts`):** Shared types for session management.
  - **Static Assets:** Custom HTML/CSS for the browser interface are in `assets/`.
  - **Binaries:** Platform-specific ttyd executables are in `binaries/`.
- **Workflow:**
  1. CLI launches a tmux session running Copilot CLI.
  2. ttyd serves the tmux session over HTTP(S) with authentication and mobile-friendly UI.
  3. Optionally, localtunnel exposes a public URL with QR code for mobile access.
  4. All processes are managed and cleaned up automatically.

## Key Conventions

- **Session Names:**
  - Auto-generated, unique, and validated for security (alphanumeric, hyphens, underscores, 3-64 chars).
- **Port Assignment:**
  - Auto-assigned if not specified; validated to avoid conflicts and ensure non-privileged range.
- **Security:**
  - Each session uses a strong random password for ttyd authentication.
  - HTTPS is enabled by default if OpenSSL is available; otherwise, falls back to HTTP.
  - Public tunnels require both a tunnel password and terminal credentials.
- **Process Cleanup:**
  - Orphaned tmux/ttyd/tunnel processes and temp files are cleaned up before starting new sessions and on shutdown.
- **Platform Support:**
  - Linux and macOS are supported natively; Windows requires WSL2.
- **No Test Suite:**
  - No tests are present; add tests to `test/` and update scripts as needed.

---

For more details, see the README.md. Update this file if you add new scripts, tests, or architectural changes.
