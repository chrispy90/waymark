import { api } from './api.js';

const form = document.getElementById('forgot-form');
const err = document.getElementById('err');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  err.textContent = '';
  const email = form.email.value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { err.textContent = 'Enter a valid email.'; return; }
  const btn = form.querySelector('button');
  btn.disabled = true;
  try {
    const { message } = await api('POST', '/api/auth/forgot', { email });
    form.hidden = true;
    const sent = document.getElementById('sent');
    sent.querySelector('.b-auth-ok').textContent = message;
    sent.hidden = false;
  } catch (ex) {
    err.textContent = ex.message;
    btn.disabled = false;
  }
});
