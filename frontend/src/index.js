import React from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { ErrorBoundary, installGlobalErrorHandlers } from './errorReporting';
import { registerServiceWorker } from './offline';
import { installInteractions } from './interactions';

installGlobalErrorHandlers();
registerServiceWorker();
installInteractions();

createRoot(document.getElementById('root')).render(
  <ErrorBoundary fullPage>
    <App />
  </ErrorBoundary>
);
