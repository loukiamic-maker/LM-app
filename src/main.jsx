import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';
import { AccountProvider } from './Account';
import './responsive-details.css';

createRoot(document.getElementById('root')).render(<React.StrictMode><AccountProvider><App /></AccountProvider></React.StrictMode>);
