# OpenCluely Overlay 2.1

Windows desktop assistant for text and image questions using Claude or Gemini.

- Always-on-top overlay with tray controls, click-through, and global shortcuts.
- Text questions, image upload/paste/drop, screenshots, and streamed answers.
- Separate Claude and Gemini keys, verified before saving with Windows encryption.
- Screen-capture protection enabled by default; check your meeting client's preview.
- Optional startup after Windows sign-in and encrypted conversation restoration.

Download the Windows installer from [Releases](https://github.com/ashokchilka99/opencluely-overlay/releases/latest). It is an unsigned development build.

See [setup, privacy and development documentation](README-OVERLAY.md), [Windows startup](docs/STARTUP.md), and [verification results](docs/VERIFICATION.md).

The installed app starts in the tray after Windows sign-in. Ctrl+Alt+Space shows or hides it. Source development requires running `npm ci` first.

For source development, use Node.js 22.12 or newer:

```powershell
npm ci
npm start
npm test
npm run test:desktop
npm run build:win
```

Desktop checks require an interactive Windows session. Test outputs stay in the ignored `.test-output/` directory. API keys, local conversations, dependencies, and generated builds are excluded from Git.

Based on [arth-agrawal/OpenCluely](https://github.com/arth-agrawal/OpenCluely) and [TechyCSR/OpenCluely](https://github.com/TechyCSR/OpenCluely). The original implementation remains available in Git history. Apache-2.0; see [LICENSE](LICENSE) and [NOTICE](NOTICE).
