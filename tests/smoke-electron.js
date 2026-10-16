'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { BrowserWindow, nativeImage, desktopCapturer, screen, safeStorage } = require('electron');
const { Store } = require('../overlay/storage');
const { setTimeout: delay } = require('node:timers/promises');

async function until(predicate, timeoutMs = 8000) {
  const started = Date.now();
  while (!(await predicate())) { if (Date.now() - started > timeoutMs) throw new Error('Desktop test timed out'); await delay(25); }
}
exports.run = async runtime => {
  const results = [], consoleErrors = [];
  const test = async (name, action) => {
    try { await action(); results.push({ name, passed: true }); console.log(`PASS ${name}`); }
    catch (error) { results.push({ name, passed: false, error: error.message }); console.error(`FAIL ${name}: ${error.message}`); throw error; }
  };
  const work = path.resolve(__dirname, '..', '.test-output');
  fs.mkdirSync(work, { recursive: true });
  const win = runtime.getWindow();
  win.webContents.on('console-message', details => { if (details.level === 'error') consoleErrors.push(details.message); });
  const js = code => Promise.race([win.webContents.executeJavaScript(code), delay(2000).then(() => { throw new Error('Renderer evaluation timed out'); })]);
  const watchdog = setTimeout(() => { console.error('Desktop suite timed out'); runtime.app.exit(1); }, 60000);
  const key = 'test-only-not-a-real-api-key';
  runtime.setKeyValidator(async () => true);
  try {
    await until(async () => await js('!!window.overlay && !!document.getElementById("provider") && document.getElementById("provider").value === "anthropic"'));
    await delay(120);
    await test('sandboxed renderer loads the interface and safe Markdown libraries', async () => {
      assert.deepEqual(await js('[typeof require, typeof window.overlay.ask, typeof marked.parse, typeof DOMPurify.sanitize]'), ['undefined','function','function','function']);
      assert.equal(win.webContents.session.isPersistent(),false, 'Renderer drafts and caches must stay in memory');
      const result = await js('window.overlay.state()'); assert.equal(result.ok,true); assert.equal(result.value.keyStatus.anthropic,false);
      assert.equal(await js('document.documentElement.scrollWidth <= innerWidth'),true);
      assert.equal(await js('document.getElementById("welcome").hidden'),false);
      // Chromium can refuse renderer snapshots for a capture-protected window.
      win.setContentProtection(false); runtime.showOverlay(false); win.setContentProtection(false);
      try {
        await delay(200);
        const capture = await win.webContents.capturePage();
        fs.writeFileSync(path.join(work,'Overlay-preview.png'), capture.toPNG());
      } finally { win.setContentProtection(true); runtime.hideOverlay(); }
    });
    await test('Windows topmost, close-to-tray, click-through and compact restoration', async () => {
      assert.equal(win.isAlwaysOnTop(),true);
      const other = new BrowserWindow({show:false,width:500,height:400});
      other.destroy(); assert.equal(win.isDestroyed(),false);
      runtime.showOverlay(false); assert.equal(win.isVisible(),true);
      win.close(); assert.equal(win.isDestroyed(),false); assert.equal(win.isVisible(),false);
      runtime.showOverlay(false);
      runtime.togglePassThrough(); assert.equal(runtime.currentState().passThrough,true); assert.equal(win.isFocusable(),false);
      runtime.togglePassThrough(); assert.equal(win.isFocusable(),true);
      const height = win.getBounds().height;
      runtime.toggleCompact(); assert.ok(Math.abs(win.getBounds().height - 122) <= 2, 'Native border may add two pixels');
      runtime.toggleCompact(); assert.equal(win.getBounds().height,height);
      runtime.hideOverlay();
    });
    await test('capture protection excludes a visible overlay from native screen capture', async () => {
      assert.equal(win.isContentProtected(), true); assert.equal(runtime.currentState().captureProtectionActive, true);
      const display = screen.getPrimaryDisplay(), previous = win.getBounds();
      const bounds = { x: display.workArea.x + 50, y: display.workArea.y + 50, width: 460, height: Math.min(600,display.workArea.height-80) };
      const backdrop = new BrowserWindow({ ...bounds, frame:false, show:false, backgroundColor:'#20eb40', webPreferences:{sandbox:true} });
      try {
        await backdrop.loadURL('data:text/html,<body style="margin:0;background:%2320eb40;height:100vh"></body>');
        // Keep the fixture above unrelated desktop apps and the overlay above it.
        backdrop.setAlwaysOnTop(true, 'screen-saver');
        win.setBounds(bounds); backdrop.showInactive(); runtime.showOverlay(false); win.moveTop();
        const isGreen = async () => {
          const sources = await desktopCapturer.getSources({ types:['screen'], thumbnailSize:{ width:Math.round(display.size.width*display.scaleFactor),height:Math.round(display.size.height*display.scaleFactor) } });
          const shot = sources.find(source => source.display_id === String(display.id)).thumbnail;
          const size = shot.getSize(), actual = win.getBounds();
          const pixel = shot.crop({ x:Math.round((actual.x+80-display.bounds.x)*size.width/display.bounds.width), y:Math.round((actual.y+220-display.bounds.y)*size.height/display.bounds.height), width:1,height:1 }).toBitmap();
          return pixel[1] > 170 && pixel[0] < 110 && pixel[2] < 110;
        };
        await runtime.saveSettings({hideFromCapture:false}); assert.equal(win.isContentProtected(), false);
        await delay(300); await until(async () => !(await isGreen()));
        await runtime.saveSettings({hideFromCapture:true}); assert.equal(win.isContentProtected(), true);
        await delay(300); await until(isGreen);
        assert.equal(runtime.store.read('preferences.json',{}).hideFromCapture,true);
        runtime.togglePassThrough(); assert.equal(win.isContentProtected(), true); runtime.togglePassThrough();
        await js('document.getElementById("settingsButton").click()');
        assert.equal(await js('document.getElementById("hideFromCapture").checked'), true);
        await until(isGreen); await js('document.getElementById("closeSettings").click()');
      } finally { backdrop.destroy(); win.setBounds(previous); runtime.hideOverlay(); }
    });
    await test('real Windows encryption protects saved keys and IPC state omits secrets', async () => {
      assert.equal(runtime.store.available(),true);
      await runtime.saveSettings({provider:'anthropic',apiKey:key});
      const disk = fs.readFileSync(path.join(runtime.app.getPath('userData'),'credentials.enc'));
      assert.equal(disk.includes(Buffer.from(key)),false);
      assert.equal(runtime.store.read('credentials.enc',{},true).anthropic,key);
      assert.equal(JSON.stringify(runtime.currentState()).includes(key),false);
      await assert.rejects(runtime.ask({text:''}),/Type a question/);
    });
    await test('verified key replacement persists, preserves the other provider, and failed saves retain the old key', async () => {
      await runtime.saveSettings({provider:'gemini',apiKey:'first-gemini-test-key'});
      runtime.setKeyValidator(async (provider, candidate) => {
        assert.equal(provider,'gemini'); assert.equal(candidate,'rejected-gemini-test-key');
        throw new Error('The new API key was rejected.');
      });
      const before = fs.readFileSync(path.join(runtime.store.directory,'credentials.enc'));
      await assert.rejects(runtime.saveSettings({provider:'gemini',apiKey:'rejected-gemini-test-key',opacity:0.7}),/rejected/);
      assert.deepEqual(fs.readFileSync(path.join(runtime.store.directory,'credentials.enc')),before);
      assert.equal(runtime.currentState().settings.opacity,0.98);
      await runtime.saveSettings({apiKey:'  '});
      assert.equal(runtime.store.read('credentials.enc',{},true).gemini,'first-gemini-test-key');
      runtime.setKeyValidator(async () => { await delay(60); return true; });
      await js('document.getElementById("settingsButton").click();document.getElementById("apiKey").value="replacement-gemini-test-key";document.getElementById("settingsForm").dispatchEvent(new Event("submit",{cancelable:true,bubbles:true}))');
      await until(async()=>await js('document.getElementById("saveButton").disabled'));
      await assert.rejects(runtime.saveSettings({provider:'anthropic'}),/already being saved/);
      await until(async()=>await js('!document.getElementById("settingsDialog").open'));
      const reopened = new Store(runtime.store.directory,safeStorage);
      assert.deepEqual(reopened.read('credentials.enc',{},true),{anthropic:key,gemini:'replacement-gemini-test-key'});
      assert.equal(await js('document.getElementById("apiKey").value'),'');
      assert.ok(!JSON.stringify(runtime.currentState()).includes('replacement-gemini-test-key'));
      const originalWrite = runtime.store.write.bind(runtime.store);
      runtime.store.write = (name,...args) => { if (name === 'preferences.json') throw new Error('Simulated disk failure'); return originalWrite(name,...args); };
      try { await assert.rejects(runtime.saveSettings({apiKey:'another-verified-test-key'}),/disk failure/); }
      finally { runtime.store.write = originalWrite; }
      assert.equal(reopened.read('credentials.enc',{},true).gemini,'replacement-gemini-test-key');
      assert.equal(reopened.read('credentials.enc',{},true).anthropic,key);
      await runtime.saveSettings({provider:'anthropic'});
    });
    const imageBytes = fs.readFileSync(path.resolve(__dirname,'..','overlay','assets','icon.png'));
    let received;
    runtime.setAnswerFunction(async options => {
      received = options;
      await delay(30); options.onDelta('The answer is **42**.\n\n');
      await delay(40); options.onDelta('```python\nprint(42)\n```\n\n<img src=x onerror="window.pwned=true"><script>window.pwned=true</script>');
      return { text:'The answer is **42**.\n\n```python\nprint(42)\n```\n\n<img src=x onerror="window.pwned=true"><script>window.pwned=true</script>', truncated:false };
    });
    await test('image paste, preview and question submission work through the real UI and IPC', async () => {
      await js(`(() => { const bytes=Uint8Array.from(atob(${JSON.stringify(imageBytes.toString('base64'))}), char=>char.charCodeAt(0)); const data=new DataTransfer(); data.items.add(new File([bytes], 'question.png', {type:'image/png'})); document.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true})); })()`);
      await until(async()=>await js('!document.getElementById("attachment").hidden'));
      await js('document.getElementById("question").value="Read and answer the question in this image";document.getElementById("question").dispatchEvent(new Event("input"));document.getElementById("questionForm").dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}))');
      await until(()=>runtime.getHistory().length===2 && !runtime.currentState().busy);
      assert.equal(received.messages.at(-1).image.mime,'image/jpeg'); assert.ok(received.messages.at(-1).image.data.length>100);
      assert.equal(await js('document.getElementById("attachment").hidden'),true);
      await until(async()=>await js('document.querySelectorAll(".message").length===2'));
      assert.equal(await js('!!document.querySelector(".message-body strong")'),true);
      assert.equal(await js('!!document.querySelector(".message-body pre code")'),true);
      assert.equal(await js('!!window.pwned || !!document.querySelector(".message-body img") || !!document.querySelector(".message-body script")'),false);
      assert.equal(consoleErrors.length,0,consoleErrors.join('\n'));
      await js('document.querySelector(".copy-code").click()');
    });
    await test('successful history is encrypted and follow-ups keep image context in memory', async () => {
      const disk=fs.readFileSync(path.join(runtime.app.getPath('userData'),'conversation.enc'));
      assert.equal(disk.includes(Buffer.from('answer is')),false);
      const decoded=runtime.store.read('conversation.enc',[],true); assert.equal(decoded.length,2); assert.ok(!JSON.stringify(decoded).includes('base64'));
      await runtime.ask({text:'Explain why'}); await until(()=>runtime.getHistory().length===4 && !runtime.currentState().busy);
      assert.equal(received.messages.length,3); assert.ok(received.messages[0].image);
    });
    await test('duplicate requests are blocked and cancellation does not commit incomplete turns', async () => {
      runtime.setAnswerFunction(async ({signal,onDelta})=>{onDelta('Partial answer');await new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('stopped')),{once:true}));});
      await runtime.ask({text:'long request'});
      await assert.rejects(runtime.ask({text:'duplicate'}),/already running/);
      await assert.rejects(runtime.saveSettings({provider:'gemini'}),/Stop the current/);
      runtime.cancel(); await until(()=>!runtime.currentState().busy);
      assert.equal(runtime.getHistory().length,4); assert.match(runtime.currentState().lastAttempt.error,/stopped/i);
    });
    await test('main frame IPC rejects a different window', async () => {
      const stranger = new BrowserWindow({show:false,webPreferences:{preload:path.resolve(__dirname,'..','overlay','preload.js'),sandbox:true,contextIsolation:true,nodeIntegration:false}});
      await stranger.loadFile(path.resolve(__dirname,'..','overlay','ui','index.html'));
      const result=await stranger.webContents.executeJavaScript('window.overlay.state()'); assert.equal(result.ok,false); assert.match(result.error,/Unauthorized/);
      stranger.destroy();
    });
    await test('renderer crash recovers without losing completed conversation', async () => {
      win.webContents.forcefullyCrashRenderer();
      await until(async()=>{try{return await js('document.querySelectorAll(".message").length>=4');}catch{return false;}},12000);
      assert.equal(runtime.getHistory().length,4); assert.equal(win.isAlwaysOnTop(),true); assert.equal(win.isContentProtected(),true);
      assert.equal(await js('document.getElementById("provider").value'),'anthropic');
    });
    await test('native display capture returns a bounded JPEG preview', async () => {
      const displays=runtime.currentState().displays;
      const image=await runtime.capture(displays.find(display=>display.primary).id);
      assert.ok(image.width<=2560 && image.height<=2560); assert.ok(image.preview.startsWith('data:image/'));
      assert.equal(nativeImage.createFromDataURL(image.preview).isEmpty(),false);
    });
    await test('deleting a key takes effect and image cache is bounded', async () => {
      for(let i=0;i<13;i++) runtime.importImage({name:`image${i}.png`,data:imageBytes.toString('base64')});
      assert.ok(runtime.images.size<=10);
      await runtime.saveSettings({provider:'anthropic',removeKey:true}); assert.equal(runtime.currentState().keyStatus.anthropic,false);
      await assert.rejects(runtime.ask({text:'hello'}),/API key/);
    });
    console.log(`Desktop tests passed: ${results.length}`);
  } catch (error) { if (!results.some(result=>!result.passed)) results.push({name:'desktop suite setup or completion',passed:false,error:error.message}); console.error(error.stack); }
  finally {
    clearTimeout(watchdog);
    fs.writeFileSync(path.join(work,'desktop-test-results.json'),JSON.stringify({results,consoleErrors,profile:runtime.app.getPath('userData')},null,2));
    runtime.app.exit(results.some(result=>!result.passed)?1:0);
  }
};
