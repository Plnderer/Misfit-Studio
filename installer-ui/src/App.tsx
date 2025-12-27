import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import './App.css';
import Installer from './components/Installer';
import Dashboard from './components/Dashboard';

type AppMode = 'installer' | 'studio';
type ModeOverride = 'auto' | AppMode;

function App() {
  const [detectedMode, setDetectedMode] = useState<AppMode | null>(null);
  const [modeError, setModeError] = useState<string | null>(null);
  const [modeOverride, setModeOverride] = useState<ModeOverride>(() => {
    const saved = localStorage.getItem('misfitModeOverride');
    if (saved === 'auto' || saved === 'installer' || saved === 'studio') {
      return saved;
    }
    return 'auto';
  });

  useEffect(() => {
    invoke<AppMode>('get_app_mode')
      .then(m => {
        setDetectedMode(m);
        setModeError(null);
      })
      .catch(e => {
        console.error('Failed to get app mode', e);
        setModeError(String(e));
      });
  }, []);

  useEffect(() => {
    localStorage.setItem('misfitModeOverride', modeOverride);
  }, [modeOverride]);

  const effectiveMode = modeOverride === 'auto' ? detectedMode : modeOverride;
  const modeToRender = effectiveMode ?? 'studio';

  if (!detectedMode && modeOverride === 'auto') {
    return (
      <div className="container">
        {modeError ? (
          <>
            <h1>Mode detection failed</h1>
            <p className="subtitle">{modeError}</p>
            <div className="actions">
              <button className="btn-secondary" type="button" onClick={() => setModeOverride('studio')}>
                Open Studio
              </button>
              <button className="btn-primary" type="button" onClick={() => setModeOverride('installer')}>
                Open Installer
              </button>
            </div>
          </>
        ) : (
          <>Summoning the court...</>
        )}
      </div>
    );
  }

  return (
    <div className="app-shell">
      <div className="mode-switch">
        <span className="mode-label">Crown Mode</span>
        <div className="mode-pills">
          <button
            type="button"
            className={`mode-pill ${modeOverride === 'auto' ? 'active' : ''}`}
            onClick={() => setModeOverride('auto')}
            aria-pressed={modeOverride === 'auto'}
          >
            Auto
          </button>
          <button
            type="button"
            className={`mode-pill ${modeOverride === 'studio' ? 'active' : ''}`}
            onClick={() => setModeOverride('studio')}
            aria-pressed={modeOverride === 'studio'}
          >
            Studio
          </button>
          <button
            type="button"
            className={`mode-pill ${modeOverride === 'installer' ? 'active' : ''}`}
            onClick={() => setModeOverride('installer')}
            aria-pressed={modeOverride === 'installer'}
          >
            Installer
          </button>
        </div>
        {modeOverride !== 'auto' && detectedMode && modeOverride !== detectedMode && (
          <div className="mode-hint">Crown override: {modeOverride} (auto is {detectedMode})</div>
        )}
      </div>
      {modeToRender === 'installer' ? <Installer /> : <Dashboard />}
    </div>
  );
}

export default App;
