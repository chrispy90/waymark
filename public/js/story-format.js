// Story file format helpers (no DOM, so the reader, the editor and the exporter can all use them).

// Block types and layouts were renamed; stories saved with the earlier names are converted on load.
const RENAMED_TYPES = { sidecar: 'scrollmap', tour: 'stops', swipe: 'compare' };
const RENAMED_LAYOUTS = { docked: 'split', floating: 'overlay' };

/** Brings a story saved by an earlier version up to the current format (in place). Returns the story. */
export function normalizeStory(story) {
  for (const block of story?.blocks || []) {
    if (RENAMED_TYPES[block.type]) block.type = RENAMED_TYPES[block.type];
    if (block.type === 'scrollmap' && RENAMED_LAYOUTS[block.layout]) block.layout = RENAMED_LAYOUTS[block.layout];
  }
  return story;
}
