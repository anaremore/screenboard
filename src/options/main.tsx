import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Options } from './Options';
import { Preview } from './Preview';
import '../ui/base.css';
import './options.css';

const captureId = new URLSearchParams(window.location.search).get('capture');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {captureId ? <Preview captureId={captureId} /> : <Options />}
  </StrictMode>,
);
