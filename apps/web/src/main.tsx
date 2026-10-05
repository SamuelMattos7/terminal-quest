import '@fontsource/inter';
import '@fontsource/jetbrains-mono';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.js';
import './theme.css';

const root = document.getElementById('root');
if (root === null) {
  throw new Error('#root element missing');
}

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
