# Windows 2.3 port record

Port prepared on 17 October 2026 from [ashokchilka99/mac-godsplan](https://github.com/ashokchilka99/mac-godsplan), reference commit [`f2b35228b67e0b22816ce779bc41c7503f24665d`](https://github.com/ashokchilka99/mac-godsplan/commit/f2b35228b67e0b22816ce779bc41c7503f24665d), the Mac 2.3 source. The Windows repository remains [ashokchilka99/opencluely-overlay](https://github.com/ashokchilka99/opencluely-overlay). This is a Windows adaptation; it does not package the Mac Swift helper or LaunchAgent.

## Feature mapping

| Mac 2.3 feature | Windows adaptation |
| --- | --- |
| Text and image answers | OpenAI API, Claude and Gemini with provider-native streaming and image payloads. |
| Provider model dropdowns and custom IDs | Per-provider model choices, custom IDs and saved selections; account access and quota still apply. |
| Local saved provider keys | Metadata API check before replacement; Windows DPAPI via Electron safeStorage; failed checks preserve the saved key. |
| Overlay across ordinary applications | Windows topmost window, tray lifetime, compact view and opacity; no repeated focus stealing or app injection. |
| Click-through and shortcuts | Pointer/focus pass-through; Ctrl+Alt+Space, Ctrl+Alt+I and Ctrl+Alt+S. |
| Upload, clipboard, drag/drop, screenshot preview | PNG/JPEG validation, bounded image memory, display selection and explicit send. |
| Capture protection | Windows `WDA_EXCLUDEFROMCAPTURE` requested by default; verify the actual meeting or recording preview. |
| New chat and saved conversations | Encrypted current chat and archives, reopen/delete controls, legacy conversation migration; image pixels are never saved. |
| Normal Quit protection | Enabled by default; ordinary close hides to tray, cooperative Quit is guarded, explicit Quit asks for confirmation. |
| Reopen after unexpected termination | Windows C#/.NET Framework helper with process-exit events, state-change notifications and bounded retry backoff. |
| Pause and explicit Quit controls | Immediate Settings/tray pause; confirmed Quit disarms helper before closing; next manual app open enables recovery again. |
| Start at login | Existing per-user Windows Run registration with `--background`, separate from recovery. |
| macOS session/permission integration | Windows session-end handling; Mac Screen Recording settings, Keychain, Dock/Spaces and launchctl code are not used. |
| Renderer and process reliability | Sandboxed renderer, caller-checked IPC, renderer recovery, single instance, suspend cancellation and display-boundary recovery. |

The ordinary Windows user can stop the app and helper. Windows shutdown and sign-out remain available. This port does not promise immunity to Task Manager, an administrator, forced termination, every third-party app, exclusive fullscreen windows or unsupported capture methods.

## Upgrade and packaging

Version 2.3 retains `com.opencluely.overlay`, **OpenCluely Overlay**, the existing executable location, and `%APPDATA%\OpenCluely Overlay`. Preserve the entire profile during an upgrade so safeStorage can restore credentials and conversations. An existing saved provider/model selection is retained. Legacy `conversation.enc` supplies existing completed history when no current archive store is available; successful saves produce encrypted `chats.enc`.

`node scripts/build-recovery.js` compiles the Windows C# helper before Electron Builder packages it outside the ASAR archive. The expected Windows installer is `OpenCluely-Overlay-Setup-2.3.0.exe`. Source and generated tests never read real user keys or enable production recovery. Windows desktop and native helper checks use temporary profiles and fixture processes.

## Current validation status

Checked on Windows 11 x64 on 17 October 2026. The checks below cover this port; [version 2.1 results](VERIFICATION.md) remain a historical record.

| Check | Status for Windows 2.3 |
| --- | --- |
| Source unit checks, provider transport and validation | 54 passed |
| Interactive Electron checks, provider/model UI, archives and restart | 24 passed, including confirmed Quit and fresh-process restoration; no skipped checks or renderer console errors |
| Cooperative Quit and explicit Quit control | Active answer survives blocked Quit, canceled Quit and separate-process WM_CLOSE; confirmed Quit exits normally |
| Windows native helper termination/reopening/pause/session-end tests | 4 passed, including repeated forced fixture exits, pause, session-end marking and stale state rejection |
| Dependency audit | 0 known vulnerabilities across production and development dependencies |
| Windows x64 packaging and helper inclusion | Setup built; source matches app.asar and helper is included outside ASAR |
| Installed upgrade and preservation of existing profile/startup | Installed 2.3.0; credentials, completed conversation, preferences and Local State preserved byte-for-byte during upgrade; saved Gemini key restored and authenticated; startup remains enabled |
| Installed native window and helper | Responsive; topmost and WDA_EXCLUDEFROMCAPTURE verified on the actual window; recovery enabled with native helper identity verified |
| Public source and installer | Version 2.3.0 source is maintained in this Windows repository; see Releases for the installer and SHA256SUMS.txt |
| Full computer reboot/sign-in | Not claimed as tested |
| Every meeting client, third-party closing tool, live paid AI model | Not claimed as tested |

Total automated checks: **82 passed**. Provider generation in the automated suite uses mock responses and test keys. The saved user Gemini key was separately restored and verified with a metadata request after installation; no live paid OpenAI or Claude generation was required. The helper's forced-termination tests use disposable fixture processes, not the user's installed app.

Canceled Windows shutdown is covered in both helper-first and overlay-first orderings. A native shutdown marker distinguishes that case from a killed helper; explicit pause clears the marker. A blocked close leaves an answer running, while explicit Quit waits for recovery cleanup. Source tests use isolated profiles and never enable production recovery.

The Windows GUI automation helper was unavailable during the installed-app check, so installed validation used native window attributes, helper identity verification, responsive process checks and encrypted profile restoration. The real interface and owner controls were exercised in the isolated Electron desktop suite. Both installer and helper are unsigned development builds.

## Reproduce

On Windows x64 with Node.js 22.12+ and Git:

```powershell
npm ci
npm test
npm run test:desktop
npm run test:recovery
npm audit
npm run build:win
```

Desktop checks need an interactive Windows desktop. The native helper tests act only on their fixture processes. Generated outputs stay outside Git. Provider/model access, answer quality and capture behavior still depend on the selected provider and the actual Windows/meeting configuration.
