# OpenCluely Overlay 2.3 for Windows

Windows desktop assistant for text and image questions using **OpenAI / ChatGPT, Claude, or Gemini**, adapted from the updated [Mac version](https://github.com/ashokchilka99/mac-godsplan).

- Always-on-top overlay with tray controls, click-through, compact view, and global shortcuts.
- Text questions, image upload/paste/drop, screenshots, and streamed answers.
- Provider-specific model presets and custom model IDs.
- Separate provider keys, checked before saving with Windows encryption.
- New chat and encrypted conversation archives that can be reopened or deleted.
- Capture exclusion and protection against normal Quit requests, enabled by default.
- An owner-controlled Windows helper that reopens the installed app after an unexpected exit.
- Optional launch after Windows sign-in, separate from automatic reopening.

Download an available Windows installer from [Releases](https://github.com/ashokchilka99/opencluely-overlay/releases). These are unsigned development builds. Version 2.3 source produces `OpenCluely-Overlay-Setup-2.3.0.exe`; see the [Windows port status](docs/WINDOWS-PORT.md) for its current validation and publication status.

See [setup, controls, privacy and development](README-OVERLAY.md), [automatic reopening and emergency stop](docs/AUTOMATIC-REOPENING.md), and [startup and shortcuts](docs/STARTUP.md).

**Ctrl+Alt+Space** shows or hides the running overlay. Closing the window hides it to the tray. Confirm **Quit OpenCluely** in Settings or the tray to stop both the overlay and automatic reopening. Windows shutdown and sign-out remain available. Windows can force terminate the app or helper; recovery does not make it immune to termination.

For source development, use Node.js 22.12 or newer:

```powershell
npm ci
npm start
npm test
npm run test:desktop
npm run test:recovery
npm run build:win
```

The build compiles the small C# recovery helper with the Windows .NET Framework compiler before packaging. Desktop checks require an interactive Windows session. Test outputs stay in the ignored `.test-output/` directory. Keys, local conversations, dependencies, and generated builds are excluded from Git.

Based on [arth-agrawal/OpenCluely](https://github.com/arth-agrawal/OpenCluely), [TechyCSR/OpenCluely](https://github.com/TechyCSR/OpenCluely), and [ashokchilka99/mac-godsplan](https://github.com/ashokchilka99/mac-godsplan). The original implementation remains available in Git history. Apache-2.0; see [LICENSE](LICENSE) and [NOTICE](NOTICE).
