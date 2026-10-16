'use strict';
const { spawn } = require('node:child_process');
const path = require('node:path');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(require('electron'), [path.join(__dirname, '..'), ...process.argv.slice(2)], { env, stdio: 'inherit', windowsHide: true });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => {
  if (code === 0 && process.argv.includes('--smoke-test')) {
    const reopen = spawn(require('electron'), [path.join(__dirname,'..','tests','reopen-electron.cjs')], { env, stdio:'inherit', windowsHide:true });
    reopen.on('error', error => { console.error(error.message); process.exitCode=1; });
    reopen.on('exit', result => { process.exitCode=result??1; });
  } else process.exitCode = code ?? 1;
});
