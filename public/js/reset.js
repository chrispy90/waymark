import { api } from './api.js';
import { mountAuthShell } from './auth-shell.js';

mountAuthShell('New password');

const token = new URLSearchParams(location.search).get('token') || '';
// Drop the token from the address bar and history once read.
history.replaceState(null, '', '/reset.html');

const form = document.getElementById('reset-form');
const err = document.getElementById('err');

const { valid } = token ? await api('GET', `/api/auth/reset/${encodeURIComponent(token)}`) : { valid: false };
if (!valid) document.getElementById('invalid').hidden = false;
else form.hidden = false;

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  err.textContent = '';
  const password = form.password.value;
  if (password.length < 8) { err.textContent = 'Password must be at least 8 characters.'; return; }
  if (password !== form.confirm.value) { err.textContent = "The passwords don't match."; return; }
  const btn = form.querySelector('button');
  btn.disabled = true;
  try {
    await api('POST', '/api/auth/reset', { token, password });
    location.replace('/');
  } catch (ex) {
    err.textContent = ex.message;
    btn.disabled = false;
  }
});
