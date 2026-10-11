import { api } from './api.js';

const form = document.getElementById('auth-form');
const err = document.getElementById('auth-error');
const next = new URLSearchParams(location.search).get('next');
const dest = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
let signup = false;

const { user, signupOpen } = await api('GET', '/api/me');
if (user) location.replace(dest);
if (!signupOpen) document.getElementById('toggle-row').hidden = true;

function setMode(isSignup) {
  signup = isSignup;
  document.getElementById('name-row').hidden = !signup;
  document.getElementById('auth-submit').textContent = signup ? 'Create account' : 'Sign in';
  document.getElementById('auth-sub').textContent = signup ? 'Create an account to publish stories.' : 'Sign in to create and publish stories.';
  document.getElementById('toggle-text').textContent = signup ? 'Have an account?' : 'No account?';
  document.getElementById('toggle-mode').textContent = signup ? 'Sign in' : 'Create one';
  form.password.autocomplete = signup ? 'new-password' : 'current-password';
  document.getElementById('forgot-link').hidden = signup;
  err.textContent = '';
}
document.getElementById('toggle-mode').addEventListener('click', () => setMode(!signup));

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  err.textContent = '';
  const body = { email: form.email.value.trim(), password: form.password.value, name: form.elements.name.value.trim() };
  if (signup && body.password.length < 8) { err.textContent = 'Password must be at least 8 characters.'; return; }
  const btn = document.getElementById('auth-submit');
  btn.disabled = true;
  try {
    await api('POST', signup ? '/api/auth/signup' : '/api/auth/login', body);
    location.replace(dest);
  } catch (ex) {
    err.textContent = ex.message;
    btn.disabled = false;
  }
});
