// Local draft storage (browser-only). Swap for an API when a backend exists.
const KEY = 'storymaps.drafts.v1';

const readAll = () => {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
};
const writeAll = (all) => {
  try { localStorage.setItem(KEY, JSON.stringify(all)); return true; } catch { return false; }
};

export const listLocalStories = () =>
  Object.values(readAll()).sort((a, b) => (b.updated || 0) - (a.updated || 0));
export const getLocalStory = (id) => readAll()[id] || null;
export function saveLocalStory(story) {
  const all = readAll();
  all[story.id] = { ...story, updated: Date.now() };
  return writeAll(all);
}
export function deleteLocalStory(id) {
  const all = readAll();
  delete all[id];
  writeAll(all);
}
export const newId = () => 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
