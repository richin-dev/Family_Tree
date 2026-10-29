#!/usr/bin/env node
// Local admin helper. Password input is masked and never written to source files.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';
import { hashPassword } from '../lib/auth.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const authDir = path.join(projectRoot, '.auth');
const usersPath = path.join(authDir, 'users.json');
const pendingPath = path.join(authDir, 'AUTH_USERS.pending.json');
const rl = createInterface({input:stdin, output:stdout});
const ask = message => rl.question(message);

function askHidden(message) {
  if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
    return Promise.reject(new Error('Run Reset-Family-Tree-Password.bat from a Windows console so password entry can be hidden.'));
  }
  stdout.write(message);
  return new Promise((resolve, reject) => {
    let value = '';
    const cleanup = () => {
      stdin.off('data', onData);
      try { stdin.setRawMode(false); } catch {}
      stdin.pause();
    };
    const onData = buffer => {
      for (const char of buffer.toString('utf8')) {
        if (char === '\u0003') { cleanup(); stdout.write('\n'); reject(new Error('Canceled.')); return; }
        if (char === '\r' || char === '\n') { cleanup(); stdout.write('\n'); resolve(value); return; }
        if (char === '\u007f' || char === '\b') {
          if (value.length) { value = value.slice(0, -1); stdout.write('\b \b'); }
          continue;
        }
        if (char >= ' ' && char !== '\u007f' && value.length < 200) { value += char; stdout.write('*'); }
      }
    };
    try { stdin.setRawMode(true); stdin.resume(); stdin.on('data', onData); }
    catch (error) { cleanup(); reject(error); }
  });
}

try {
  if (!fs.existsSync(usersPath)) throw new Error('Local .auth/users.json was not found. Run this from the Family Tree project checkout.');
  let users;
  try { users = JSON.parse(fs.readFileSync(usersPath, 'utf8')); }
  catch { throw new Error('Could not read .auth/users.json. The local account file is not valid JSON.'); }
  if (!Array.isArray(users) || !users.length) throw new Error('The local account file contains no users.');

  const names = users.map(user => String(user?.u || '')).filter(Boolean);
  if (names.length !== users.length) throw new Error('The local account file contains an invalid user entry.');
  console.log('\nFamily Tree password reset');
  console.log('Account whose password will change: ' + (names.length === 1 ? names[0] : ''));
  if (names.length > 1) console.log('Accounts included in Production AUTH_USERS: ' + names.join(', '));
  console.log('The Production AUTH_USERS secret will be replaced using this complete local account list.');
  console.log('Stop if any family account is missing from the list.');

  let username = names[0];
  if (names.length > 1) {
    username = (await ask('Existing username to reset: ')).trim();
    if (!names.includes(username)) throw new Error('That username is not in the local reset file.');
  }
  const approval = await ask(`Type RESET to set a new password for ${username}: `);
  if (approval !== 'RESET') {
    console.log('Canceled. No password or Cloudflare setting was changed.');
  } else {
    rl.close();
    const password = await askHidden('Enter your new password (hidden, 12–200 characters): ');
    const confirmation = await askHidden('Enter it again (hidden): ');
    if (password.length < 12 || password.length > 200) throw new Error('Password must be between 12 and 200 characters. Nothing was changed.');
    if (password !== confirmation) throw new Error('The passwords did not match. Nothing was changed.');

    const index = users.findIndex(user => user.u === username);
    const updatedUsers = [...users];
    updatedUsers[index] = {...users[index], ...(await hashPassword(password))};
    const authUsers = JSON.stringify(updatedUsers);
    fs.mkdirSync(authDir, {recursive:true});
    fs.writeFileSync(pendingPath, authUsers + '\n', {encoding:'utf8', mode:0o600});

    console.log('\nUpdating Cloudflare Pages Production AUTH_USERS…');
    const command = process.platform === 'win32' ? 'cmd.exe' : 'npx';
    const args = process.platform === 'win32'
      ? ['/d', '/s', '/c', 'npx --yes wrangler pages secret put AUTH_USERS --project-name=family-tree-private --env=production']
      : ['--yes', 'wrangler', 'pages', 'secret', 'put', 'AUTH_USERS', '--project-name=family-tree-private', '--env=production'];
    const result = spawnSync(command, args, {
      cwd:projectRoot, input:authUsers + '\n', encoding:'utf8', windowsHide:true, maxBuffer:2 * 1024 * 1024
    });
    const rawOutput = [result.stdout, result.stderr, result.error?.message].filter(Boolean).join('\n');
    const safeOutput = rawOutput.split(authUsers).join('[AUTH_USERS value redacted]').trim();

    if (result.status === 0) {
      fs.writeFileSync(usersPath, JSON.stringify(updatedUsers, null, 2) + '\n', {encoding:'utf8', mode:0o600});
      try { fs.rmSync(pendingPath, {force:true}); } catch {}
      console.log('\nPassword changed for ' + username + '. Your chosen password was not displayed or saved by this tool.');
      console.log('Now redeploy the latest Production deployment in Cloudflare Pages for the change to take effect.');
    } else {
      console.error('\nCloudflare did not confirm the update. The new password is NOT active in Production yet.');
      console.error('Updated AUTH_USERS is saved in .auth/AUTH_USERS.pending.json. After manually setting that value in Cloudflare, copy the same file over .auth/users.json to keep local and Production accounts synchronized. Do not commit or share either file.');
      if (safeOutput) console.error('\nWrangler message:\n' + safeOutput.slice(-1800));
      process.exitCode = 1;
    }
  }
} catch (error) {
  console.error('\nReset did not complete: ' + (error?.message || 'unknown error'));
  process.exitCode = 1;
} finally {
  rl.close();
}