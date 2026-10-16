'use strict';

const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, screen, desktopCapturer, clipboard, nativeImage, dialog, safeStorage, session, powerMonitor } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { DEFAULTS, MAX_IMAGE_BYTES, validateSettings, validateQuestion, inspectImage, clampBounds, boundedContext, diskHistory, validateHistory } = require('./core');
const { streamAnswer, validateApiKey } = require('./providers');
const { Store } = require('./storage');

const testMode = !app.isPackaged && process.argv.includes('--smoke-test');
if (testMode) app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'opencluely-test-')));
app.setName('OpenCluely Overlay');
app.setAppUserModelId('com.opencluely.overlay');

let win, tray, store, quitting = false, settings, keys = {}, history = [], active = null, lastAttempt = null;
let passThrough = false, captureBusy = false, settingsBusy = false, geometryTimer, normalBounds;
let screenshotRestore = true;
const images = new Map(), warnings = [], recoveryTimes = [], shortcuts = [];
const html = path.join(__dirname, 'ui', 'index.html');
const pageURL = pathToFileURL(html).href;
let answerFunction = streamAnswer;
let keyValidator = validateApiKey;

function log(code) {
  try {
    const file = path.join(app.getPath('userData'), 'diagnostics.log');
    if (fs.existsSync(file) && fs.statSync(file).size > 512000) fs.renameSync(file, `${file}.previous`);
    fs.appendFileSync(file, `${new Date().toISOString()} ${code}\n`);
  } catch { /* Logging must never prevent recovery. No prompts, keys or API bodies are logged. */ }
}
function warn(message) { if (!warnings.includes(message)) warnings.push(message); log('warning'); }
function emit(event) { if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send('overlay:event', event); }
function publicImage(image) { return { id: image.id, name: image.name, preview: image.preview, width: image.width, height: image.height }; }
function currentState() {
  return {
    settings, history: diskHistory(history), passThrough, busy: !!active, captureBusy,
    active: active ? { id: active.id, question: active.question, text: active.text, image: active.image ? publicImage(active.image) : null, provider: active.provider, model: active.model } : null,
    lastAttempt: lastAttempt ? { ...lastAttempt, image: images.has(lastAttempt.question.imageId) ? publicImage(images.get(lastAttempt.question.imageId)) : null } : null,
    keyStatus: { anthropic: !!keys.anthropic, gemini: !!keys.gemini },
    secureStorage: store.available(), warnings, shortcuts,
    captureProtectionActive: !!win && !win.isDestroyed() && win.isContentProtected(),
    startupAvailable: app.isPackaged && !process.env.PORTABLE_EXECUTABLE_DIR,
    displays: screen.getAllDisplays().map((display, i) => ({ id: String(display.id), name: display.label || `Display ${i + 1}`, primary: display.id === screen.getPrimaryDisplay().id }))
  };
}
function syncState() { emit({ type: 'state', value: currentState() }); updateTray(); }
function persistSettings() { store.write('preferences.json', settings); }
function persistHistory() {
  try {
    if (settings.rememberHistory && store.available()) store.write('conversation.enc', diskHistory(history), true);
    else store.remove('conversation.enc');
  } catch { warn('The conversation could not be saved. It is still available until you quit.'); }
}

function fitWindow() {
  if (!win || win.isDestroyed()) return;
  const bounds = win.getBounds();
  const display = screen.getDisplayMatching(bounds);
  win.setBounds(clampBounds(bounds, display.workArea, settings.compact));
}
function applyWindowMode() {
  if (!win || win.isDestroyed()) return;
  // Apply before first show, and restore after sleep, focus/mode changes or recovery.
  try { win.setContentProtection(settings.hideFromCapture); }
  catch { warn('Screen capture protection could not be enabled. Check Settings and your sharing preview before sharing.'); }
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setOpacity(settings.opacity);
  win.setIgnoreMouseEvents(passThrough, { forward: true });
  win.setFocusable(!passThrough);
  if (process.platform === 'darwin') win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
}
function showOverlay(focus = false) {
  if (!win || win.isDestroyed()) createWindow();
  if (focus) passThrough = false;
  applyWindowMode(); fitWindow();
  if (win.isMinimized()) win.restore();
  if (focus) { win.show(); win.focus(); emit({ type: 'focus-input' }); }
  else win.showInactive();
  syncState();
}
function hideOverlay() { screenshotRestore = false; if (win && !win.isDestroyed()) win.hide(); updateTray(); }
function toggleVisibility() { if (win?.isVisible()) hideOverlay(); else showOverlay(true); }
function togglePassThrough() {
  passThrough = !passThrough;
  applyWindowMode(); syncState();
  if (!passThrough) showOverlay(true);
  return passThrough;
}
function saveGeometry() {
  clearTimeout(geometryTimer);
  geometryTimer = setTimeout(() => {
    if (!win || win.isDestroyed() || quitting) return;
    const bounds = win.getBounds();
    settings.bounds = settings.compact ? { ...bounds, height: normalBounds?.height || 700 } : bounds;
    if (!settings.compact) normalBounds = bounds;
    try { persistSettings(); } catch { warn('Window position could not be saved.'); }
  }, 350);
}
function toggleCompact() {
  if (!win || win.isDestroyed()) return false;
  if (!settings.compact) normalBounds = win.getBounds();
  settings.compact = !settings.compact;
  const bounds = settings.compact ? win.getBounds() : { ...win.getBounds(), height: normalBounds?.height || 700 };
  win.setMinimumSize(360, settings.compact ? 122 : 440);
  win.setBounds(clampBounds(bounds, screen.getDisplayMatching(bounds).workArea, settings.compact));
  try { persistSettings(); } catch { warn('Window preference could not be saved.'); }
  syncState(); return settings.compact;
}
function recoverRenderer(reason) {
  if (quitting || !win || win.isDestroyed()) return;
  active?.controller.abort();
  const now = Date.now();
  recoveryTimes.push(now);
  while (recoveryTimes[0] < now - 60000) recoveryTimes.shift();
  log(`renderer-recovery:${reason}`);
  passThrough = false; applyWindowMode();
  if (recoveryTimes.length <= 3) win.reload();
  else {
    hideOverlay();
    dialog.showMessageBox({ type: 'error', title: 'Overlay needs a restart', message: 'The overlay failed repeatedly. Your saved conversation is preserved.', detail: 'Use the tray menu to show the overlay again, or quit and reopen the app.', buttons: ['OK'] }).catch(() => {});
  }
}
function createWindow() {
  const saved = settings.bounds;
  const display = saved ? screen.getDisplayMatching(saved) : screen.getPrimaryDisplay();
  normalBounds = clampBounds(saved, display.workArea, false);
  win = new BrowserWindow({
    ...clampBounds(saved, display.workArea, settings.compact), minWidth: 360, minHeight: settings.compact ? 122 : 440,
    title: 'OpenCluely Overlay', icon: path.join(__dirname, 'assets', 'icon.png'),
    frame: false, transparent: false, backgroundColor: '#111a18', show: false,
    alwaysOnTop: true, skipTaskbar: true, autoHideMenuBar: true, maximizable: false, fullscreenable: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), partition: 'overlay-memory', nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, backgroundThrottling: true, spellcheck: false }
  });
  applyWindowMode();
  win.setMenu(null);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.on('will-attach-webview', event => event.preventDefault());
  win.webContents.on('render-process-gone', (_event, details) => recoverRenderer(details.reason));
  win.on('unresponsive', async () => {
    log('renderer-unresponsive');
    const result = await dialog.showMessageBox({ type: 'warning', title: 'Overlay is busy', message: 'The overlay is not responding.', buttons: ['Reload overlay', 'Wait'], defaultId: 1, cancelId: 1 });
    if (result.response === 0) recoverRenderer('unresponsive');
  });
  win.on('close', event => { if (!quitting) { event.preventDefault(); hideOverlay(); } });
  win.on('closed', () => { win = null; });
  win.on('move', saveGeometry); win.on('resize', saveGeometry);
  win.webContents.on('did-finish-load', () => syncState());
  win.webContents.on('did-fail-load', (_event, code) => { if (code !== -3) { warn('The overlay could not load. Quit and reopen from the tray.'); } });
  win.once('ready-to-show', () => { if (!testMode && !process.argv.includes('--background')) win.showInactive(); });
  win.loadFile(html).catch(() => warn('The overlay could not load.'));
}
function updateTray() {
  if (!tray || tray.isDestroyed()) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'OpenCluely Overlay', enabled: false },
    { label: 'Show and type a question', click: () => showOverlay(true) },
    { label: win?.isVisible() ? 'Hide overlay (keep running)' : 'Show overlay without focus', click: () => win?.isVisible() ? hideOverlay() : showOverlay(false) },
    { type: 'separator' },
    { label: 'Click-through', type: 'checkbox', checked: passThrough, click: togglePassThrough },
    { label: 'Compact view', type: 'checkbox', checked: settings.compact, click: toggleCompact },
    { label: 'Settings', click: () => { showOverlay(true); emit({ type: 'open-settings' }); } },
    { type: 'separator' },
    { label: 'Quit OpenCluely', click: () => app.quit() }
  ]));
}

function addImage(native, name) {
  if (!native || native.isEmpty()) throw new Error('This image could not be decoded. Choose a different PNG or JPEG.');
  const original = native.getSize();
  if (original.width * original.height > 32_000_000) throw new Error('The image exceeds 32 megapixels.');
  const ratio = Math.min(1, 2560 / Math.max(original.width, original.height));
  const resized = ratio < 1 ? native.resize({ width: Math.round(original.width * ratio), height: Math.round(original.height * ratio), quality: 'best' }) : native;
  const bytes = resized.toJPEG(92);
  if (bytes.length > 4 * 1024 * 1024) throw new Error('The processed image is too large. Please crop it first.');
  const size = resized.getSize();
  const preview = resized.resize({ width: Math.min(260, size.width), quality: 'good' }).toDataURL();
  const image = { id: randomUUID(), name: String(name || 'Image').slice(0, 160), mime: 'image/jpeg', data: bytes.toString('base64'), preview, ...size };
  images.set(image.id, image);
  // Keep a bounded image cache. Old image names remain in history but pixels are released.
  while (images.size > 10) {
    const removable = [...images.keys()].find(id => id !== active?.question.imageId && id !== image.id);
    if (!removable) break;
    images.delete(removable);
  }
  return publicImage(image);
}
function importImage(input) {
  if (!input || typeof input.data !== 'string' || input.data.length > Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(input.data)) throw new Error('Choose a PNG or JPEG up to 10 MB.');
  const bytes = Buffer.from(input.data, 'base64');
  inspectImage(bytes);
  return addImage(nativeImage.createFromBuffer(bytes), input.name);
}
async function capture(displayId) {
  if (captureBusy) throw new Error('A screenshot is already in progress.');
  if (displayId != null && (typeof displayId !== 'string' || !screen.getAllDisplays().some(display => String(display.id) === displayId))) throw new Error('That display is no longer connected.');
  captureBusy = true;
  screenshotRestore = true;
  const visible = win && !win.isDestroyed() && win.isVisible();
  const display = displayId ? screen.getAllDisplays().find(display => String(display.id) === displayId) : screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  if (visible) win.hide();
  try {
    await new Promise(resolve => setTimeout(resolve, 180));
    const scale = Math.min(display.scaleFactor || 1, 2560 / Math.max(display.size.width, display.size.height));
    let captureTimer;
    let sources;
    try {
      sources = await Promise.race([
        desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: Math.round(display.size.width * scale), height: Math.round(display.size.height * scale) } }),
        new Promise((_resolve, reject) => { captureTimer = setTimeout(() => reject(new Error('Screenshot timed out. Upload an image or try again.')), 10000); })
      ]);
    } finally { clearTimeout(captureTimer); }
    const source = sources.find(source => source.display_id === String(display.id));
    if (!source) throw new Error('Could not capture this display. Check screen-recording permission or upload an image instead.');
    return addImage(source.thumbnail, `${display.label || 'Screen'} screenshot`);
  } finally {
    captureBusy = false;
    if (visible && screenshotRestore && win && !win.isDestroyed() && !quitting) { applyWindowMode(); win.showInactive(); }
    syncState();
  }
}

async function ask(input) {
  if (active) throw new Error('An answer is already running. Stop it before asking another question.');
  if (settingsBusy) throw new Error('Settings are being saved. Please try again.');
  const question = validateQuestion(input);
  const provider = settings.provider, model = settings.models[provider], apiKey = keys[provider];
  if (!apiKey) throw new Error(`Add your ${provider === 'anthropic' ? 'Claude' : 'Gemini'} API key in Settings first.`);
  const image = question.imageId ? images.get(question.imageId) : null;
  if (question.imageId && !image) throw new Error('This attachment expired. Please attach the image again.');
  const request = { id: randomUUID(), question, image, provider, model, text: '', controller: new AbortController() };
  active = request; lastAttempt = null;
  emit({ type: 'start', id: request.id, question, image: image ? publicImage(image) : null, provider, model });
  updateTray();
  // Returning immediately lets the UI cancel while the stream is running.
  void (async () => {
    try {
      const answer = await answerFunction({ provider, model, apiKey, messages: boundedContext(history, question, id => images.get(id)), signal: request.controller.signal,
        onDelta: delta => { request.text += delta; emit({ type: 'delta', id: request.id, text: delta }); },
        onStatus: text => emit({ type: 'status', id: request.id, text }) });
      request.controller.signal.throwIfAborted();
      const createdAt = new Date().toISOString();
      history.push({ id: randomUUID(), role: 'user', text: question.text, imageId: question.imageId, imageName: image?.name, createdAt },
        { id: request.id, role: 'assistant', text: answer.text, provider, model, createdAt });
      history = history.slice(-40);
      persistHistory();
      emit({ type: 'done', id: request.id, text: answer.text, truncated: answer.truncated });
    } catch (error) {
      const message = request.controller.signal.aborted ? 'Answer stopped. You can retry when you are ready.' : error.message;
      lastAttempt = { id: request.id, question, text: request.text, error: message, provider, model };
      emit({ type: 'error', ...lastAttempt }); log('request-failed');
    } finally {
      if (active === request) active = null;
      syncState();
    }
  })();
  return { id: request.id };
}

async function saveSettings(input) {
  if (settingsBusy) throw new Error('Settings are already being saved.');
  if (active) throw new Error('Stop the current answer before changing settings.');
  settingsBusy = true;
  try {
    const next = validateSettings(input, settings);
    if (next.rememberHistory && !store.available()) throw new Error('Secure storage is unavailable. Turn off conversation history to save preferences.');
    const nextKeys = { ...keys };
    let replacementKey = '';
    if (input.apiKey != null) {
      if (typeof input.apiKey !== 'string' || input.apiKey.length > 500) throw new Error('Enter a valid API key, or leave the field blank to keep your saved key.');
      replacementKey = input.apiKey.trim();
      if (replacementKey && (/\s/.test(replacementKey) || replacementKey.length < 12)) throw new Error('Enter a valid API key, or leave the field blank to keep your saved key.');
      if (replacementKey && input.removeKey === true) throw new Error('Choose either replacing or removing the saved key.');
      if (replacementKey) {
        if (!store.available()) throw new Error('Secure storage is unavailable. The new key cannot be saved.');
        await keyValidator(next.provider, replacementKey);
        nextKeys[next.provider] = replacementKey;
      }
    }
    if (input.removeKey === true) delete nextKeys[next.provider];
    const startupChanged = next.launchAtLogin !== settings.launchAtLogin;
    if (startupChanged && (!app.isPackaged || process.env.PORTABLE_EXECUTABLE_DIR)) throw new Error('Launch at sign-in is available in the installed app. Install the Windows setup first.');
    const credentialsChanged = !!replacementKey || input.removeKey === true;
    // A user can move/compact the window while the network check is in progress.
    next.bounds = settings.bounds;
    if (!('compact' in input)) next.compact = settings.compact;
    const hadCredentials = fs.existsSync(path.join(store.directory, 'credentials.enc'));
    try {
      if (credentialsChanged) store.write('credentials.enc', nextKeys, true);
      if (startupChanged) app.setLoginItemSettings({ openAtLogin: next.launchAtLogin, path: process.execPath, args: ['--background'] });
      store.write('preferences.json', next);
    } catch (error) {
      try {
        if (credentialsChanged) { if (hadCredentials) store.write('credentials.enc', keys, true); else store.remove('credentials.enc'); }
        if (startupChanged) app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin, path: process.execPath, args: ['--background'] });
      } catch { warn('Settings could not be fully restored after a disk error. Reopen Settings and check your preferences.'); }
      throw error;
    }
    settings = next; keys = nextKeys;
    applyWindowMode(); persistHistory(); syncState();
    return currentState();
  } finally { settingsBusy = false; }
}

function handle(channel, action) {
  ipcMain.handle(`overlay:${channel}`, async (event, ...args) => {
    if (!win || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame || event.senderFrame.url !== pageURL) return { ok: false, error: 'Unauthorized app request.' };
    try { return { ok: true, value: await action(...args) }; }
    catch (error) { return { ok: false, error: error.message || 'This action could not be completed.' }; }
  });
}
function registerIPC() {
  handle('state', currentState); handle('ask', ask);
  handle('cancel', () => { active?.controller.abort(); return true; });
  handle('upload', async () => {
    const result = await dialog.showOpenDialog(win, { title: 'Attach a question image', properties: ['openFile'], filters: [{ name: 'Question images', extensions: ['png', 'jpg', 'jpeg'] }] });
    if (result.canceled || !result.filePaths[0]) return null;
    const file = result.filePaths[0];
    if (fs.statSync(file).size > MAX_IMAGE_BYTES) throw new Error('Choose an image up to 10 MB.');
    const bytes = fs.readFileSync(file); inspectImage(bytes);
    return addImage(nativeImage.createFromBuffer(bytes), path.basename(file));
  });
  handle('paste-image', () => {
    const image = clipboard.readImage();
    if (image.isEmpty()) return null;
    return addImage(image, 'Clipboard image');
  });
  handle('import-image', importImage); handle('capture', capture);
  handle('release-image', id => { if (typeof id === 'string' && !history.some(message => message.imageId === id) && active?.question.imageId !== id && lastAttempt?.question.imageId !== id) images.delete(id); return true; });
  handle('save-settings', saveSettings);
  handle('clear', () => {
    if (active) throw new Error('Stop the answer before clearing the conversation.');
    // Remove the saved file first, so a disk failure does not falsely report deletion.
    store.remove('conversation.enc'); history = []; lastAttempt = null; images.clear(); syncState(); return true;
  });
  handle('export', async () => {
    if (!history.length) throw new Error('There is no completed conversation to export.');
    const result = await dialog.showSaveDialog(win, { title: 'Export conversation', defaultPath: 'OpenCluely-conversation.md', filters: [{ name: 'Markdown', extensions: ['md'] }] });
    if (result.canceled || !result.filePath) return false;
    const content = history.map(message => `## ${message.role === 'user' ? 'You' : 'Assistant'}\n\n${message.imageName ? `[Image: ${message.imageName}]\n\n` : ''}${message.text}\n`).join('\n');
    fs.writeFileSync(result.filePath, content, 'utf8'); return true;
  });
  handle('hide', hideOverlay); handle('pass-through', togglePassThrough); handle('compact', toggleCompact);
  handle('copy', text => { if (typeof text !== 'string' || text.length > 80000) throw new Error('Invalid clipboard text.'); clipboard.writeText(text); return true; });
  handle('quit', () => { app.quit(); return true; });
}
function registerShortcuts() {
  const commands = [
    ['CommandOrControl+Alt+Space', 'Show / hide', toggleVisibility],
    ['CommandOrControl+Alt+I', 'Click-through', togglePassThrough],
    ['CommandOrControl+Alt+S', 'Screenshot', async () => {
      try { const image = await capture(); showOverlay(true); emit({ type: 'attach', image }); }
      catch (error) { showOverlay(false); emit({ type: 'notice', text: error.message }); }
    }]
  ];
  for (const [accelerator, label, action] of commands) {
    let registered = false;
    try { registered = globalShortcut.register(accelerator, action); } catch { /* Surface conflicts in UI. */ }
    shortcuts.push({ accelerator, label, registered });
    if (!registered) warn(`${label} shortcut is unavailable because another app may be using it. Use the tray or overlay buttons.`);
  }
}

async function initialize() {
  store = new Store(app.getPath('userData'), safeStorage, warn);
  const loaded = store.read('preferences.json', DEFAULTS);
  try { settings = validateSettings(loaded); settings.bounds = loaded.bounds && ['x','y','width','height'].every(key => Number.isFinite(loaded.bounds[key])) ? loaded.bounds : null; }
  catch { settings = { ...DEFAULTS, models: { ...DEFAULTS.models } }; warn('Saved settings were invalid. Defaults are in use.'); }
  if (!store.available()) { settings.rememberHistory = false; warn('Secure storage is unavailable. API keys and history cannot be saved.'); }
  const credentials = store.read('credentials.enc', {}, true);
  for (const provider of ['anthropic', 'gemini']) if (typeof credentials?.[provider] === 'string' && credentials[provider].length <= 500) keys[provider] = credentials[provider];
  if (settings.rememberHistory) {
    try { history = validateHistory(store.read('conversation.enc', [], true)); }
    catch { warn('Saved conversation could not be restored.'); }
  }
  const overlaySession = session.fromPartition('overlay-memory');
  overlaySession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  overlaySession.setPermissionCheckHandler(() => false);
  // The renderer uses only packaged files and data-URL image previews. AI networking stays in main.
  overlaySession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !['file:', 'data:', 'devtools:'].some(prefix => details.url.startsWith(prefix)) }));
  createWindow();
  tray = new Tray(path.join(__dirname, 'assets', 'tray.png'));
  tray.setToolTip('OpenCluely Overlay — Ctrl+Alt+Space');
  tray.on('click', () => showOverlay(true)); updateTray();
  registerIPC(); registerShortcuts();
  for (const event of ['display-added', 'display-removed', 'display-metrics-changed']) screen.on(event, () => { fitWindow(); syncState(); });
  powerMonitor.on('resume', () => { applyWindowMode(); fitWindow(); syncState(); });
  powerMonitor.on('suspend', () => { active?.controller.abort(); });
  log('app-ready');
  if (testMode) {
    await require('../tests/smoke-electron').run({ app, getWindow: () => win, store, currentState, ask, saveSettings, importImage, capture, images, showOverlay, hideOverlay, togglePassThrough, toggleCompact,
      setAnswerFunction: fn => { answerFunction = fn; }, setKeyValidator: fn => { keyValidator = fn; }, cancel: () => active?.controller.abort(), clear: () => { history = []; images.clear(); lastAttempt = null; persistHistory(); syncState(); },
      getHistory: () => history });
  }
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (settings) showOverlay(true); });
  app.on('activate', () => { if (settings) showOverlay(true); });
  app.on('window-all-closed', () => { /* The tray owns lifetime; closing the UI keeps the app running. */ });
  app.on('before-quit', () => {
    quitting = true; active?.controller.abort(); clearTimeout(geometryTimer);
    if (settings && store) {
      if (win && !win.isDestroyed()) { const bounds = win.getBounds(); settings.bounds = { ...bounds, height: settings.compact ? normalBounds?.height || 700 : bounds.height }; }
      try { persistSettings(); persistHistory(); } catch { log('shutdown-save-failed'); }
    }
  });
  app.on('will-quit', () => { globalShortcut.unregisterAll(); tray?.destroy(); });
  app.whenReady().then(initialize).catch(error => {
    log('startup-failed');
    if (testMode) { console.error(error); app.exit(1); }
    else { dialog.showErrorBox('OpenCluely could not start', 'The app could not initialize. Reopen it or reinstall the app. Your saved data is preserved.'); app.quit(); }
  });
}
process.on('uncaughtException', () => { log('main-process-fatal'); app.exit(1); });
process.on('unhandledRejection', () => { log('unhandled-operation'); });
