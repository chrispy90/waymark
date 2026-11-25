// Tactical Video-Game Juice & Synthesized Web Audio SFX for Scenarios (zero dependencies).
// Provides crisp tactical audio cues (muteable), cinematic turn-phase splash banners,
// map destination order pings, and a floating RTS-style selected-unit HUD card.
import { h, icon } from './ui.js';
import { KINDS, sideOf, statusLabel } from './scenario-core.js';

const SFX_PREF_KEY = 'wm.scenario.sfx';

function loadSfxPref() {
  try {
    const v = localStorage.getItem(SFX_PREF_KEY);
    return v === null ? true : v === '1';
  } catch {
    return true;
  }
}

export function createGameFx(ctx) {
  let sfxOn = loadSfxPref();
  let audioCtx = null;
  let stageEl = null;
  let splashEl = null;
  let splashTimer = 0;
  let hudCardEl = null;
  let sfxBtn = null;

  function ensureAudio() {
    if (!sfxOn || typeof window === 'undefined') return null;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!audioCtx) audioCtx = new AC();
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    return audioCtx;
  }

  function tone(freq, dur, { type = 'sine', gain = 0.08, delay = 0, freqEnd = null } = {}) {
    const ac = ensureAudio();
    if (!ac) return;
    const now = ac.currentTime + delay;
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (freqEnd) osc.frequency.exponentialRampToValueAtTime(freqEnd, now + dur);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(gain, now + Math.min(0.012, dur * 0.25));
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    osc.connect(g);
    g.connect(ac.destination);
    osc.start(now);
    osc.stop(now + dur + 0.02);
  }

  const sfx = {
    select() {
      tone(680, 0.06, { type: 'triangle', gain: 0.07, freqEnd: 960 });
      tone(1020, 0.05, { type: 'sine', gain: 0.04, delay: 0.04 });
    },
    move() {
      tone(220, 0.09, { type: 'triangle', gain: 0.09, freqEnd: 130 });
      tone(520, 0.055, { type: 'sine', gain: 0.055, delay: 0.03, freqEnd: 640 });
    },
    turn() {
      tone(196, 0.28, { type: 'triangle', gain: 0.09 });
      tone(293.66, 0.30, { type: 'triangle', gain: 0.07, delay: 0.06 });
      tone(392, 0.38, { type: 'sine', gain: 0.065, delay: 0.12 });
    },
    combat() {
      tone(140, 0.18, { type: 'sawtooth', gain: 0.08, freqEnd: 58 });
      tone(440, 0.09, { type: 'square', gain: 0.035, delay: 0.05, freqEnd: 310 });
    },
    inject() {
      tone(880, 0.08, { type: 'square', gain: 0.045 });
      tone(1174, 0.12, { type: 'square', gain: 0.045, delay: 0.1 });
    },
    ui() {
      tone(540, 0.035, { type: 'sine', gain: 0.04, freqEnd: 620 });
    },
  };

  function setSfx(on) {
    sfxOn = !!on;
    try { localStorage.setItem(SFX_PREF_KEY, sfxOn ? '1' : '0'); } catch { /* ignore */ }
    if (sfxBtn) {
      sfxBtn.classList.toggle('is-sfx-on', sfxOn);
      sfxBtn.setAttribute('aria-pressed', sfxOn ? 'true' : 'false');
      sfxBtn.title = sfxOn ? 'Tactical Sound FX: ON (click to mute)' : 'Tactical Sound FX: MUTED (click to enable)';
    }
    if (sfxOn) sfx.select();
  }

  function showTurnSplash(label, sub = 'ORDERS PHASE') {
    if (!splashEl) return;
    splashEl.querySelector('.wg-splash-kicker').textContent = sub;
    splashEl.querySelector('.wg-splash-title').textContent = label;
    splashEl.classList.remove('is-on');
    void splashEl.offsetWidth;
    splashEl.classList.add('is-on');
    clearTimeout(splashTimer);
    splashTimer = setTimeout(() => splashEl?.classList.remove('is-on'), 1850);
  }

  function pingMap(lngLat, color = '#38bdf8') {
    const map = ctx.map;
    if (!map || !stageEl || !lngLat) return;
    const pt = map.project(lngLat);
    if (!pt) return;
    const el = h('div', {
      class: 'wg-order-ping',
      style: `left:${pt.x}px;top:${pt.y}px;--ping-c:${color}`,
      'aria-hidden': 'true',
    });
    stageEl.append(el);
    setTimeout(() => el.remove(), 750);
  }

  function renderUnitHud() {
    if (!hudCardEl || !ctx.doc) return;
    const u = ctx.selected ? ctx.unitById(ctx.selected) : null;
    if (!u || !ctx.shown(u)) {
      hudCardEl.hidden = true;
      return;
    }
    const side = sideOf(ctx.doc, u.side);
    const str = Math.max(0, Math.min(100, Number(u.strength) || 0));
    const sup = Math.max(0, Math.min(100, Number(u.supply ?? 100)));
    const strColor = str > 60 ? '#22c55e' : str > 30 ? '#f59e0b' : '#ef4444';
    const supColor = sup > 50 ? '#38bdf8' : sup > 25 ? '#f59e0b' : '#ef4444';

    hudCardEl.style.setProperty('--hud-side', side.color);
    hudCardEl.replaceChildren(
      h('div', { class: 'wg-uhud-sym' }, ctx.symbol(u, 30)),
      h('div', { class: 'wg-uhud-info' },
        h('div', { class: 'wg-uhud-top' },
          h('strong', {}, u.name),
          h('span', { class: 'wg-uhud-side' }, side.name)),
        h('div', { class: 'wg-uhud-meta' }, `${KINDS[u.kind]?.label || 'Unit'} · ${statusLabel(u.status)}`),
        h('div', { class: 'wg-uhud-bars' },
          h('div', { class: 'wg-uhud-bar', title: `Strength ${str}%` },
            h('span', {}, 'STR'),
            h('i', {}, h('b', { style: `width:${str}%;background:${strColor}` })),
            h('em', {}, `${str}%`)),
          h('div', { class: 'wg-uhud-bar', title: `Supply ${sup}%` },
            h('span', {}, 'SUP'),
            h('i', {}, h('b', { style: `width:${sup}%;background:${supColor}` })),
            h('em', {}, `${sup}%`)))),
      h('div', { class: 'wg-uhud-acts' },
        h('button', { type: 'button', class: 'wg-uhud-btn', title: 'Center camera on unit', onclick: () => { ctx.map?.easeTo({ center: u.lngLat, duration: 450 }); sfx.ui(); } }, icon('target', { size: 14 })),
        ctx.canEdit ? h('button', { type: 'button', class: 'wg-uhud-btn', title: 'Open Combat panel', onclick: () => { ctx.setTool('combat'); sfx.ui(); } }, icon('swords', { size: 14 })) : null,
        h('button', { type: 'button', class: 'wg-uhud-btn', title: 'Deselect (Esc / B)', onclick: () => { ctx.select(null); sfx.ui(); } }, icon('x', { size: 14 }))));
    hudCardEl.hidden = false;
  }

  function mount(stage, btn) {
    stageEl = stage;
    sfxBtn = btn;
    if (sfxBtn) {
      sfxBtn.classList.toggle('is-sfx-on', sfxOn);
      sfxBtn.setAttribute('aria-pressed', sfxOn ? 'true' : 'false');
      sfxBtn.title = sfxOn ? 'Tactical Sound FX: ON (click to mute)' : 'Tactical Sound FX: MUTED (click to enable)';
    }
    const frame = h('div', { class: 'wg-hud-frame', 'aria-hidden': 'true' },
      h('span', { class: 'wg-corner tl' }),
      h('span', { class: 'wg-corner tr' }),
      h('span', { class: 'wg-corner bl' }),
      h('span', { class: 'wg-corner br' }));
    splashEl = h('div', { class: 'wg-turn-splash', 'aria-live': 'polite' },
      h('div', { class: 'wg-splash-kicker' }, 'ORDERS PHASE'),
      h('div', { class: 'wg-splash-title' }, 'TURN 1'));
    hudCardEl = h('div', { class: 'wg-uhud', hidden: true });
    stageEl.append(frame, splashEl, hudCardEl);
  }

  return {
    mount,
    sfx,
    setSfx,
    isSfxOn: () => sfxOn,
    showTurnSplash,
    pingMap,
    renderUnitHud,
  };
}
