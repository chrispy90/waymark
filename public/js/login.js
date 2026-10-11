import { api } from './api.js';
import { mountAuthShell } from './auth-shell.js';
import { BRAND } from './ui.js';

mountAuthShell('Sign in');
const form = document.getElementById('auth-form');
const err = document.getElementById('auth-error');
const next = new URLSearchParams(location.search).get('next');
const dest = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
let signup = false;

const { user, signupOpen, firstRun } = await api('GET', '/api/me');
if (user) location.replace(dest);

function setMode(isSignup) {
  signup = isSignup;
  const $ = (id) => document.getElementById(id);
  $('name-row').hidden = !signup;
  $('pw-hint').hidden = !signup;
  $('forgot-link').hidden = signup;
  $('auth-submit').textContent = firstRun ? 'Create account and start' : signup ? 'Create account' : 'Sign in';
  $('auth-title').textContent = firstRun ? `Set up ${BRAND.name}` : signup ? 'Create your account' : 'Welcome back';
  $('auth-sub').textContent = firstRun ? "You're the first one here. Create the owner account to get started."
    : signup ? 'Start telling stories with maps in a minute.' : 'Sign in to keep working on your stories.';
  $('toggle-text').textContent = signup ? 'Already have an account?' : 'New here?';
  $('toggle-mode').textContent = signup ? 'Sign in' : 'Create an account';
  $('toggle-row').hidden = firstRun || !signupOpen;
  form.password.autocomplete = signup ? 'new-password' : 'current-password';
  err.textContent = '';
  (signup ? form.elements.name : form.email).focus();
}
document.getElementById('toggle-mode').addEventListener('click', () => setMode(!signup));
setMode(firstRun || new URLSearchParams(location.search).has('signup'));

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  err.textContent = '';
  const body = { email: form.email.value.trim(), password: form.password.value, name: form.elements.name.value.trim() };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) { err.textContent = 'Enter a valid email address.'; form.email.focus(); return; }
  if (signup && body.password.length < 8) { err.textContent = 'Use at least 8 characters for your password.'; form.password.focus(); return; }
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
