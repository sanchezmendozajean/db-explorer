import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import './theme/base.css';

const container = document.getElementById('root');
if (!container) throw new Error('No se encontró el elemento raíz');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
