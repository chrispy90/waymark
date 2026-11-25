import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyDeadzone, stickCurve, pickReticleTarget, pickRadialSlice, stepSelectOption, stepRangeInput, XBOX, XBOX_BINDINGS } from '../public/js/scenario-gamepad.js';

describe('scenario-gamepad helpers', () => {
  it('zeros stick input inside radial deadzone and scales smoothly outside', () => {
    assert.deepEqual(applyDeadzone(0.05, -0.05, 0.16), [0, 0]);
    assert.deepEqual(applyDeadzone(0.16, 0, 0.16), [0, 0]);
    const [xFull, yFull] = applyDeadzone(1, 0, 0.16);
    assert.ok(Math.abs(xFull - 1) < 1e-6);
    assert.equal(yFull, 0);
    const [xHalf] = applyDeadzone(0.58, 0, 0.16); // halfway through active range
    assert.ok(xHalf > 0 && xHalf < 0.35, 'response curve keeps fine control gentle at mid-stick');
  });

  it('applies trigger deadzone and preserves sign', () => {
    assert.equal(stickCurve(0.05, 0.08), 0);
    assert.equal(stickCurve(-0.07, 0.08), 0);
    assert.ok(Math.abs(stickCurve(1, 0.08) - 1) < 1e-6);
    assert.ok(Math.abs(stickCurve(-1, 0.08) + 1) < 1e-6);
  });

  it('magnetically snaps reticle to closest unit within snap radius', () => {
    const units = [
      { id: 'u1', lngLat: [0, 0] },
      { id: 'u2', lngLat: [1, 1] },
    ];
    const project = ([lng]) => (lng === 0 ? { x: 515, y: 405 } : { x: 505, y: 402 });
    const picked = pickReticleTarget(units, project, 500, 400, 44);
    assert.equal(picked?.id, 'u2');
    const none = pickReticleTarget(units, () => ({ x: 900, y: 900 }), 500, 400, 44);
    assert.equal(none, null);
  });

  it('defines standard Xbox button indices and control map entries', () => {
    assert.equal(XBOX.A, 0);
    assert.equal(XBOX.B, 1);
    assert.equal(XBOX.MENU, 9);
    assert.ok(XBOX_BINDINGS.length >= 12);
  });

  it('cycles select dropdown options and nudges range sliders cleanly', () => {
    let fired = 0;
    const sel = { options: ['infantry', 'armor', 'artillery'], selectedIndex: 0, dispatchEvent: () => { fired++; } };
    assert.equal(stepSelectOption(sel, 1), true);
    assert.equal(sel.selectedIndex, 1);
    assert.equal(stepSelectOption(sel, -2), true);
    assert.equal(sel.selectedIndex, 2);
    assert.equal(fired, 2);

    let sliderEvents = 0;
    const rng = { min: '0', max: '100', step: '5', value: '50', dispatchEvent: () => { sliderEvents++; } };
    assert.equal(stepRangeInput(rng, 1), true);
    assert.equal(rng.value, '55');
    assert.equal(stepRangeInput(rng, -1), true);
    assert.equal(rng.value, '50');
    assert.ok(sliderEvents >= 2);
  });

  it('maps stick angle to the 6-slice radial wheel clockwise from top', () => {
    assert.equal(pickRadialSlice(0, 0, 6), -1);
    assert.equal(pickRadialSlice(0, -1, 6), 0); // 12 o'clock: Place Unit
    assert.equal(pickRadialSlice(0.86, -0.5, 6), 1); // 2 o'clock: Combat
    assert.equal(pickRadialSlice(0.86, 0.5, 6), 2); // 4 o'clock: Reach Rings
    assert.equal(pickRadialSlice(0, 1, 6), 3); // 6 o'clock: Dice
    assert.equal(pickRadialSlice(-0.86, 0.5, 6), 4); // 8 o'clock: MGRS Grid
    assert.equal(pickRadialSlice(-0.86, -0.5, 6), 5); // 10 o'clock: Fog View
  });
});
