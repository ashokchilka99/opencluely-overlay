'use strict';
const {app,safeStorage}=require('electron');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {Store}=require('../overlay/storage');
const resultsFile=path.resolve(__dirname,'..','.test-output','desktop-test-results.json');
const report=JSON.parse(fs.readFileSync(resultsFile,'utf8'));
const profile=path.resolve(report.profile);
assert.equal(path.dirname(profile),path.resolve(os.tmpdir()));
assert.ok(path.basename(profile).startsWith('opencluely-test-'));
app.setName('OpenCluely Overlay');
app.setPath('userData',profile);
app.setAppUserModelId('com.opencluely.overlay');
app.whenReady().then(()=>{
  const result={name:'verified replacement key restores in a new Electron process',passed:false};
  try {
    const store=new Store(profile,safeStorage);
    assert.deepEqual(store.read('credentials.enc',{},true),{gemini:'replacement-gemini-test-key'});
    assert.equal(store.read('preferences.json',{}).hideFromCapture,true);
    assert.equal(store.read('conversation.enc',[],true).length,4);
    result.passed=true; console.log(`PASS ${result.name}`);
  } catch { result.error='Saved test profile did not restore after process restart'; console.error(`FAIL ${result.name}`); }
  report.results.push(result); fs.writeFileSync(resultsFile,JSON.stringify(report,null,2)); app.exit(result.passed?0:1);
});
