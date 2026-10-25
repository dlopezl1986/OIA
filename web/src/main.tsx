import { render } from 'preact';
import { App } from './app';
import { createPlatform } from './platform';
import './styles.css';

const root = document.getElementById('app')!;

createPlatform()
  .then((p) => render(<App platform={p} />, root))
  .catch((e: Error) => {
    root.textContent = e.message;
    root.className = 'center error-text';
  });

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => undefined));
}
