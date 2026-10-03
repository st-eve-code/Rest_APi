import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

const container = document.getElementById('root');

if (!container) {
  throw new Error('index.html is missing the <div id="root"> element');
}

createRoot(container).render(
  // StrictMode double-invokes effects in development on purpose: it surfaces
  // bugs like missing cleanup. The AbortController cleanup in `useItems` is
  // written to survive that.
  <StrictMode>
    <App />
  </StrictMode>,
);