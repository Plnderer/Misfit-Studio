import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { confirm } from '@tauri-apps/plugin-dialog';
import '../App.css';

interface InstallStep {
    type: string;
    [key: string]: any;
}

interface InstallManifest {
    appName: string;
    version: string;
    publisher: string;
    description: string;
    logoPath?: string;
    advancedMode?: boolean;
    targets: string[];
    payloadDir: string;
    installSteps: InstallStep[];
}

export default function Installer() {
    const [manifest, setManifest] = useState<InstallManifest | null>(null);
    const [status, setStatus] = useState<'loading' | 'ready' | 'installing' | 'complete' | 'error'>('loading');
    const [logs, setLogs] = useState<string[]>([]);
    const [errorMsg, setErrorMsg] = useState<string>('');
    const logEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        async function load() {
            try {
                const man = await invoke<InstallManifest>('get_manifest');
                setManifest(man);
                setStatus('ready');
                addLog(`Decree loaded for ${man.appName} v${man.version}`);
            } catch (e) {
                setStatus('error');
                setErrorMsg(`Failed to load decree: ${e}`);
                addLog(`Error: ${e}`);
            }
        }
        load();

        const unlistenPromise = listen<string>('log', (event) => {
            addLog(event.payload);
        });

        return () => {
            unlistenPromise.then(unlisten => unlisten());
        };
    }, []);

    const addLog = (msg: string) => {
        setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
    };

    useEffect(() => {
        logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [logs]);

    const handleInstall = async () => {
        if (!manifest) return;
        const commandSteps = manifest.installSteps.filter(step => step.type === 'runCommand');
        if (commandSteps.length > 0) {
            const commands = commandSteps
                .map(step => step.command)
                .filter((cmd): cmd is string => typeof cmd === 'string' && cmd.trim().length > 0);
            const sample = commands.slice(0, 5);
            const extra = commands.length > 5 ? `\n...and ${commands.length - 5} more` : '';
            const summary = sample.length ? `\n${sample.join('\n')}${extra}` : '';
            const proceed = await confirm(
                `This installer will run system commands.${summary}\n\nContinue?`,
                { title: 'Run commands?', kind: 'warning' }
            );
            if (!proceed) {
                addLog('Installation cancelled by user.');
                return;
            }
        }
        setStatus('installing');
        addLog('Enacting installation...');
        try {
            await invoke('run_install', { manifest });
            setStatus('complete');
            addLog('Decree enacted.');
        } catch (e) {
            setStatus('error');
            setErrorMsg(`Enactment failed: ${e}`);
            addLog(`Error: ${e}`);
        }
    };

    const handleRestore = async () => {
        if (!manifest) return;
        setStatus('installing');
        addLog('Restoring from the royal archive...');
        try {
            await invoke('restore_backup', { app_name: manifest.appName });
            setStatus('complete');
            addLog('Restoration complete.');
        } catch (e) {
            setStatus('error');
            setErrorMsg(`Restoration failed: ${e}`);
            addLog(`Restore Error: ${e}`);
        }
    };

    if (status === 'loading') return <div className="container">Summoning installer...</div>;
    if (!manifest && status === 'error') return <div className="container error"><h1>Error</h1><p>{errorMsg}</p></div>;

    return (
        <div className="container">
            <header className="header">
                {manifest?.logoPath && <img src={manifest.logoPath} alt="Logo" className="logo" />}
                <div className="title-area">
                    <h1>{manifest?.appName || 'Installer'}</h1>
                    <p className="subtitle">Edition {manifest?.version} by {manifest?.publisher}</p>
                </div>
            </header>

            <main className="main-content">
                <p className="description">{manifest?.description}</p>

                {status === 'error' && <div className="error-banner">{errorMsg}</div>}

                <div className="log-panel">
                    {logs.map((log, i) => <div key={i} className="log-line">{log}</div>)}
                    <div ref={logEndRef} />
                </div>

                <div className="actions">
                    {status === 'ready' && (
                        <>
                            <button className="btn-secondary" onClick={handleRestore} style={{ marginRight: '1rem' }}>Restore Archive</button>
                            <button className="btn-primary" onClick={handleInstall}>Enact Install</button>
                        </>
                    )}
                    {(status === 'installing') && (
                        <button className="btn-primary" disabled>Enacting...</button>
                    )}
                    {status === 'complete' && (
                        <button className="btn-success" disabled>Decree Complete</button>
                    )}
                </div>
            </main>
        </div>
    );
}
