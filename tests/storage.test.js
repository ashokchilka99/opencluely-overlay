'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../overlay/storage');

test('secure persistence uses the encryption provider and atomic rename', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'opencluely-store-test-')); t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const crypto = {isEncryptionAvailable:()=>true,encryptString:text=>Buffer.from(text.split('').reverse().join('')),decryptString:bytes=>bytes.toString().split('').reverse().join('')};
  const store = new Store(directory,crypto); store.write('credentials.enc',{key:'secret-key'},true);
  assert.ok(!fs.readFileSync(path.join(directory,'credentials.enc'),'utf8').includes('secret-key'));
  assert.deepEqual(store.read('credentials.enc',{},true),{key:'secret-key'}); assert.ok(!fs.existsSync(path.join(directory,'credentials.enc.tmp')));
});
test('corrupt data is preserved and reported; encryption never falls back to plaintext', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'opencluely-store-test-')); t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const notices=[]; const store=new Store(directory,{isEncryptionAvailable:()=>false},text=>notices.push(text));
  fs.writeFileSync(path.join(directory,'preferences.json'),'broken'); assert.deepEqual(store.read('preferences.json',{}),{});
  assert.equal(notices.length,1); assert.equal(fs.readFileSync(path.join(directory,'preferences.json'),'utf8'),'broken');
  assert.throws(()=>store.write('credentials.enc',{key:'secret'},true),/Secure storage/); assert.ok(!fs.existsSync(path.join(directory,'credentials.enc')));
});
