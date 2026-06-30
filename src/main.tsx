import React from 'react';
import ReactDOM from 'react-dom/client';
import { getCurrentWindow } from '@tauri-apps/api/window';
import App from './App';
import './App.css';

const windowLabel = getCurrentWindow().label;

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);

if (windowLabel === 'voice_popup') {
    // @ts-ignore
    import('./components/VoicePopup').then(({ VoicePopup }: { VoicePopup: React.ComponentType }) => {
        root.render(<React.StrictMode><VoicePopup /></React.StrictMode>);
    });
} else if (windowLabel === 'tray_popup') {
    import('./components/TrayPopup').then(({ TrayPopup }) => {
        root.render(<React.StrictMode><TrayPopup /></React.StrictMode>);
    });
} else {
    root.render(
        <React.StrictMode>
            <App />
        </React.StrictMode>
    );
}
