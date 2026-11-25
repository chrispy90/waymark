import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { battleOfTheBulgeDemo } from '../public/js/scenario-demos.js';
import { storyFromScenario } from '../public/js/scenario-core.js';
import * as R from '../public/js/scenario-rules.js';
import { branchDiff } from '../public/js/scenario-report.js';

describe('Battle of the Bulge demo scenario', () => {
  it('builds a valid multi-turn historical scenario with objectives, supply lines, injects, and what-if branch', () => {
    const doc = battleOfTheBulgeDemo();
    assert.equal(doc.sides.length, 2);
    assert.equal(doc.branches.length, 2);
    assert.equal(doc.branches[0].turns.length, 3);
    assert.equal(doc.branches[0].turns[2].units.length, 16);
    assert.equal(doc.objectives.length, 5);
    assert.equal(doc.network.nodes.length, 3);
    assert.equal(doc.network.links.length, 5);
    assert.equal(doc.injects.length, 4);

    // Advancing to Turn 3 clears weather, fires "Clear Winter Skies", and spawns Patton's 4th Armored & P-47s
    const next = R.startTurn(doc, 'main');
    assert.equal(next.index, 3);
    const t3 = doc.branches[0].turns[3];
    assert.equal(t3.weather, 'clear');
    assert.ok(t3.units.some((u) => u.id === 'u_4arm'));
    assert.ok(t3.units.some((u) => u.id === 'u_p47'));
    assert.ok(next.injects.some((i) => i.id === 'inj_skies'));

    // Ghost branch diff and Story Map export work cleanly on the demo
    const diff = branchDiff(doc, 'main', 'alt_peiper', 2);
    assert.ok(diff.features.length > 0);
    const story = storyFromScenario(doc, { branches: ['main'] });
    assert.ok(story.blocks.length >= 2);
  });
});
