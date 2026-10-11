// Allow-list HTML sanitizer for author-supplied rich text.
const TAGS = new Set(['P', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'A', 'UL', 'OL', 'LI', 'H2', 'H3', 'H4', 'BLOCKQUOTE', 'CODE', 'SPAN', 'SMALL']);
const ATTRS = { A: ['href', 'title'] };

export function sanitize(html = '') {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const root = doc.body.firstChild;
  clean(root);
  return root.innerHTML;
}

function clean(node) {
  [...node.childNodes].forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) return;
    if (child.nodeType !== Node.ELEMENT_NODE || !TAGS.has(child.tagName)) {
      // drop the element but keep its text content (except script/style)
      if (child.nodeType === Node.ELEMENT_NODE && !/^(SCRIPT|STYLE|IFRAME|OBJECT)$/.test(child.tagName)) {
        clean(child);
        child.replaceWith(...child.childNodes);
      } else child.remove();
      return;
    }
    [...child.attributes].forEach((a) => {
      if (!(ATTRS[child.tagName] || []).includes(a.name)) child.removeAttribute(a.name);
    });
    if (child.tagName === 'A') {
      if (!/^(https?:|mailto:|#)/i.test(child.getAttribute('href') || '')) child.removeAttribute('href');
      child.setAttribute('target', '_blank');
      child.setAttribute('rel', 'noopener noreferrer');
    }
    clean(child);
  });
}

export const safeUrl = (u = '') => (/^(https?:)?\/\//i.test(u) || /^[\w./-]+$/.test(u) ? u : '');
