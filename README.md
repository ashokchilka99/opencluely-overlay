<div align="center">

# OpenCluely

**The invisible AI interview copilot.**

Real-time AI help on a stealth overlay that screen sharing cannot see. Ask by voice or screenshot, and get clear answers that stream in as you need them.

<p>
  <a href="https://github.com/arth-agrawal/OpenCluely/releases/latest"><img src="https://img.shields.io/github/v/release/arth-agrawal/OpenCluely?style=for-the-badge&label=Latest&color=111111&labelColor=000000" alt="Latest release" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-111111?style=for-the-badge&labelColor=000000" alt="MIT License" /></a>
  <img src="https://img.shields.io/badge/Platforms-Windows%20%7C%20macOS%20%7C%20Linux-111111?style=for-the-badge&labelColor=000000" alt="Platforms" />
  <img src="https://img.shields.io/badge/AI-Gemini%20%7C%20Claude-111111?style=for-the-badge&labelColor=000000" alt="AI providers" />
</p>

<a href="#setup-macos">macOS setup</a> &nbsp;|&nbsp;
<a href="#quick-start">Quick start</a> &nbsp;|&nbsp;
<a href="#configuration">Configuration</a> &nbsp;|&nbsp;
<a href="#keyboard-shortcuts">Shortcuts</a>

</div>

## What it is

OpenCluely is a desktop app for technical interviews and practice. It places a small overlay on your screen that recording and conferencing tools do not capture. You can speak a question or take a screenshot, and the AI answers in real time. The answer streams into a floating window and an optional chat panel, with clean code blocks and syntax highlighting.

It is free and open source. Processing stays on your machine, and the only thing that leaves your device is the request you send to the AI provider (Google Gemini or Anthropic Claude).

This repository is based on [TechyCSR/OpenCluely](https://github.com/TechyCSR/OpenCluely), with Anthropic Claude support, macOS overlay fixes, and setup improvements.

## Highlights

- **Invisible overlay.** Windows stay out of Zoom, Google Meet, Microsoft Teams, Discord, and OBS captures on macOS and Windows. You see the answer; the call does not.
- **Gemini or Claude.** Pick Google Gemini or Anthropic Claude (Opus 5 / Sonnet 5) via Settings or `.env`.
- **Flexible local voice.** Local Whisper with VAD or manual capture, or Azure Speech in the cloud.
- **Direct image analysis.** Screenshots go straight to the model for visual reasoning (click **DSA** or press `Cmd/Ctrl+Shift+S`).
- **Session memory.** Follow-ups keep context across the interview.
- **Language aware.** Tailored answers for C++, C, Python, Java, and JavaScript.
- **Cross platform.** Windows, macOS (from source), and Linux.

## Setup (macOS)

Recommended path if you are on a Mac.

### 1. Prerequisites

- **Node.js 18+** — [nodejs.org](https://nodejs.org/) or `brew install node`
- **Git**
- **ffmpeg** (for Whisper) — `brew install ffmpeg`

### 2. Clone and set up

```bash
git clone https://github.com/arth-agrawal/OpenCluely.git
cd OpenCluely
chmod +x setup.sh
./setup.sh --no-run
```

`setup.sh` installs npm deps, creates `.env` from `env.example`, and bootstraps local Whisper.

### 3. Add your AI key

Edit `.env` in the project folder (or paste the key in Settings on first launch):

**Anthropic (Claude) — recommended if you have Anthropic credits:**

```bash
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-your-real-key-here
ANTHROPIC_MODEL=claude-opus-5
ANTHROPIC_EFFORT=medium
ANTHROPIC_THINKING=off
```

Get a key at [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys).

**Or Google Gemini:**

```bash
LLM_PROVIDER=gemini
GEMINI_API_KEY=your_gemini_api_key_here
```

Get a key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey).

Optional: verify the LLM without opening the UI:

```bash
npm run test-llm
```

### 4. Run

```bash
npm start
```

### 5. macOS permissions (do this once before a real interview)

| Permission | Where | Needed for |
|---|---|---|
| **Screen Recording** | System Settings → Privacy & Security → Screen Recording | Screenshot / DSA solve |
| **Microphone** | System Settings → Privacy & Security → Microphone | Voice (`Alt+R`) |

Accept the prompts the first time you capture or use the mic. Overlay stays interactive when the status dot is green (`Alt+A` / `Cmd+Shift+I` toggles click-through).

### 6. Use it on LeetCode / Meet

1. Open the problem in Safari/Chrome.
2. Make sure the overlay status dot is **green** (interactive).
3. Click **DSA** (or press `Cmd+Shift+S`) to capture and solve.
4. Answer streams in the transparent overlay — scroll or resize if needed.
5. `Cmd+Shift+V` hides/shows the overlay.

Speech note: the mic hears **your** voice (default input), not the interviewer through speakers. Use screenshot/DSA for on-screen problems, or type in chat (`Cmd+Shift+C`).

## Quick start

Works on Windows, macOS, and Linux.

1. Clone the repository.

   ```bash
   git clone https://github.com/arth-agrawal/OpenCluely.git
   cd OpenCluely
   ```

2. Run the setup script.

   ```bash
   ./setup.sh
   ```

   The script installs Node dependencies, creates your `.env` from the example, sets up a local Whisper virtual environment, points the config at it, and launches the app.

3. Add an AI provider key.

   On first launch, choose **Google Gemini** or **Anthropic Claude** and paste the key, or edit `.env` directly. Changes apply without a restart.

### Platform notes

- On Windows, use Git Bash (included with Git for Windows) or WSL to run `setup.sh`.
- On macOS and Linux, your normal terminal works.
- **macOS users must build from source** — there is no pre-built `.dmg` (Gatekeeper blocks unsigned downloads).
- No manual `npm` commands are required for first setup; the script handles it.

### Setup script options

```bash
./setup.sh --build                # Build a distributable for your OS
./setup.sh --ci                   # Use npm ci instead of npm install
./setup.sh --no-run               # Set up only, do not launch
./setup.sh --install-system-deps  # Install sox for the microphone (optional)
./setup.sh --skip-whisper         # Skip the local Whisper bootstrap
```

## Configuration

The setup script writes sensible defaults. The only required value is an API key for whichever AI provider you choose.

```bash
# Required: which backend generates answers — "gemini" or "anthropic"
LLM_PROVIDER=anthropic

# Required when LLM_PROVIDER=gemini
GEMINI_API_KEY=your_gemini_api_key_here

# Required when LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=your_anthropic_api_key_here
# Optional Anthropic tuning
ANTHROPIC_MODEL=claude-opus-5   # or claude-sonnet-5 for faster, cheaper answers
ANTHROPIC_EFFORT=medium         # low | medium | high | xhigh | max
ANTHROPIC_THINKING=off          # "adaptive" reasons first but delays the answer
ANTHROPIC_MAX_TOKENS=8192

# Optional speech provider. Pick one.
SPEECH_PROVIDER=whisper

# Azure option
AZURE_SPEECH_KEY=your_azure_speech_key
AZURE_SPEECH_REGION=your_region

# Local Whisper option
WHISPER_COMMAND=whisper
WHISPER_MODEL_DIR=.whisper-models
WHISPER_MODEL=small
WHISPER_LANGUAGE=auto
WHISPER_DEVICE=auto
WHISPER_PYTHON=
WHISPER_CAPTURE_MODE=vad
WHISPER_RESPONSE_TARGET=both
WHISPER_MANUAL_MAX_MS=90000
WHISPER_GPU_IDLE_MS=60000
```

Speech is optional. If no provider is configured, the microphone button hides itself across the app.

> **Note:** If you set `SSL_CERT_FILE` / `REQUESTS_CA_BUNDLE` for Python Whisper on macOS, the app keeps those for Whisper only and clears them from the Electron process so Anthropic/Gemini HTTPS keeps working.

## Optional voice setup

You can use local Whisper for offline transcription or Azure Speech for a cloud option.

For local Whisper, `./setup.sh` handles the full setup. It creates `.venv-whisper`, installs `openai-whisper`, points `.env` at the virtual environment, creates `.whisper-models`, and runs a quick speech test.

For Azure Speech, create a Speech resource in the [Azure Portal](https://portal.azure.com/), then add the key and region to `.env` with `SPEECH_PROVIDER=azure`.

```bash
npm run test-speech   # check Whisper / Azure connectivity
npm run test-llm      # check Gemini / Anthropic connectivity
```

## How it works

1. **Ask.** Click **DSA**, use `Cmd/Ctrl+Shift+S`, speak (`Alt+R`), or type in chat.
2. **Reason.** Gemini or Claude reads the screenshot / audio / text with session context.
3. **Answer.** Responses stream into the transparent overlay and/or chat.

## Keyboard shortcuts

| Action | Shortcut | Description |
|---|---|---|
| Screenshot / solve | `Cmd/Ctrl + Shift + S` | Capture the screen and analyze (same as clicking **DSA**) |
| Toggle speech | `Alt + R` | Start or stop voice recognition, if configured |
| Toggle visibility | `Cmd/Ctrl + Shift + V` | Show or hide all windows |
| Toggle interaction | `Cmd/Ctrl + Shift + I` or `Alt + A` | Enable or disable click-through |
| Open chat | `Cmd/Ctrl + Shift + C` | Open the interactive chat window |
| Settings | `Cmd/Ctrl + ,` | Open the settings panel |

## Project status

### Done

- Stealth overlay with a draggable command bar and click-through toggle
- Hidden during screen share on macOS / Windows
- Screenshot capture with direct model analysis (Gemini or Claude)
- Anthropic Claude provider (Opus 5 / Sonnet 5 / Haiku), Settings + onboarding
- Overlay stays on all Spaces / over Safari, WhatsApp, Meet, etc.
- Configurable manual or VAD-driven Whisper capture
- DSA button triggers capture + solve
- Session memory, chat UI, language picker, DSA skill prompt

### Planned

- More model backends (OpenAI, local)
- Auto-typing of code snippets into editors
- Export of conversation history

## Troubleshooting

<details>
<summary>Setup issues</summary>

- **setup.sh will not run.** Make sure you are in the project folder (`cd OpenCluely`) and that the script is executable (`chmod +x setup.sh`). On Windows, use Git Bash.
- **Node or npm not found.** Install Node.js 18+ from [nodejs.org](https://nodejs.org/), restart the terminal, and retry.
- **`npm start` exits immediately.** Another OpenCluely instance may be holding the lock. Quit it, or run:
  ```bash
  pkill -f "OpenCluely/node_modules/electron"
  rm -f ~/Library/Application\ Support/opencluely/Singleton*
  npm start
  ```

</details>

<details>
<summary>App issues</summary>

- **DSA / screenshot does nothing.** Status dot must be green (interactive). Press `Alt+A` or `Cmd+Shift+I`.
- **Overlay only on the desktop, not over Safari.** Restart after the latest pull — overlays use macOS panel + all-Spaces pinning.
- **CERTIFICATE_VERIFY_FAILED spam / LLM fails.** Do not leave Python `SSL_CERT_FILE` affecting Electron; current builds isolate those vars to Whisper. Restart the app after updating.
- **macOS screen capture does not work.** Grant Screen Recording under System Settings → Privacy & Security, then relaunch.
- **Microphone not working.** Grant Microphone permission. Voice is optional; Whisper or Azure must be configured in `.env`.
- **Invalid API key.** Run `npm run test-llm` and confirm `LLM_PROVIDER` matches the key you set.

</details>

<details>
<summary>Limitations</summary>

- **Screen-capture invisibility does not work on Linux.** Stealth overlay hiding from shares works on **macOS** and **Windows** only (`setContentProtection`). On Linux the overlay can appear in screen shares.
- **Mic hears your input device**, not system audio from Meet/Zoom speakers. Use screenshot/DSA for on-screen problems.

</details>

## Privacy and ethics

OpenCluely collects no data and sends no telemetry. Processing happens locally, and your session stays on your device. Requests to the AI provider are encrypted in transit.

The app is built for learning and practice. You are responsible for following the rules of any interview you take and the policies of the companies involved.

## License

Released under the MIT License. See [LICENSE](LICENSE) for details.

## Acknowledgments

- Original project by [TechyCSR](https://techycsr.dev) — [TechyCSR/OpenCluely](https://github.com/TechyCSR/OpenCluely)
- Google Gemini and Anthropic Claude for AI reasoning
- Azure Speech and OpenAI Whisper for optional voice input
- Electron for the cross-platform desktop runtime
- [Vysper by varun-singhh](https://github.com/varun-singhh/Vysper) for UI and structure inspiration

<div align="center">

Fork maintained for local interview use. Star the [upstream project](https://github.com/TechyCSR/OpenCluely) if it helped you.

</div>
