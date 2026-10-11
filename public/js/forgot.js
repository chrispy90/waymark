import { api } from './api.js';
import { mountAuthShell } from './auth-shell.js';

mountAuthShell('Reset password');
const form = document.getElementById('forgot-form');
const err = document.getElementById('err');
form.email.focus();

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  err.textContent = '';
  const email = form.email.value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { err.textContent = 'Enter a valid email address.'; return; }
  const btn = form.querySelector('button');
  btn.disabled = true;
  try {
    const { message } = await api('POST', '/api/auth/forgot', { email });
    form.hidden = true;
    const sent = document.getElementById('sent');
    sent.querySelector('.notice').textContent = message;
    sent.hidden = false;
  } catch (ex) {
    err.textContent = ex.message;
    btn.disabled = false;
  }
});
