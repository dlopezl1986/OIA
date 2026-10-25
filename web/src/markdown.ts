import DOMPurify from 'dompurify';
import { marked } from 'marked';

marked.setOptions({ gfm: true, breaks: false });

// Las respuestas de los modelos son datos no confiables: se sanean antes de mostrarse.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer nofollow');
  }
});

export function renderMarkdown(text: string): string {
  return DOMPurify.sanitize(marked.parse(text, { async: false }), {
    FORBID_TAGS: ['style', 'img', 'iframe', 'form', 'input', 'button'],
    FORBID_ATTR: ['style'],
  });
}
