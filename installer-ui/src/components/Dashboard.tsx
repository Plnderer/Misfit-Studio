
import { useState, useRef, useEffect, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open, confirm, save } from '@tauri-apps/plugin-dialog';
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

interface BuildRequest {
    projectName: string;
    manifest: InstallManifest;
    payloadFiles: [string, string][]; // [source, relative_dest]
    forceOverwrite?: boolean;
}

interface BuildTargetInfo {
    path: string;
    exists: boolean;
    hasMarker: boolean;
    isAbsolute: boolean;
}

interface ScanEntry {
    name: string;
    path: string;
}

type StepType = 'copy' | 'patchBlock' | 'setJsonValue' | 'base64Embed' | 'runCommand';

interface BaseStep {
    id: string;
    type: StepType;
    enabled: boolean;
}

interface CopyStep extends BaseStep {
    type: 'copy';
    payloadSource: string;
    payloadRel: string;
    dest: string;
}

interface ReplacementPair {
    key: string;
    value: string;
}

interface PatchBlockStep extends BaseStep {
    type: 'patchBlock';
    file: string;
    startMarker: string;
    endMarker: string;
    contentSource: string;
    contentRel: string;
    replacements: ReplacementPair[];
}

interface SetJsonValueStep extends BaseStep {
    type: 'setJsonValue';
    file: string;
    keyPath: string;
    valueType: 'string' | 'number' | 'boolean' | 'json';
    valueRaw: string;
    valueBool: boolean;
}

interface Base64EmbedStep extends BaseStep {
    type: 'base64Embed';
    file: string;
    placeholder: string;
    inputSource: string;
    inputRel: string;
}

interface RunCommandStep extends BaseStep {
    type: 'runCommand';
    command: string;
    args: string;
}

type UiStep = CopyStep | PatchBlockStep | SetJsonValueStep | Base64EmbedStep | RunCommandStep;

type IssueLevel = 'error' | 'warning';

interface StepIssue {
    level: IssueLevel;
    message: string;
}

type DistributiveOmit<T, K extends keyof any> = T extends any ? Omit<T, K> : never;

type PresetStep = DistributiveOmit<UiStep, 'id'>;

interface PresetData {
    appName: string;
    version: string;
    publisher: string;
    description: string;
    advancedMode: boolean;
    payloadDir?: string;
    steps: PresetStep[];
}

interface Preset {
    name: string;
    data: PresetData;
}

const PRESET_STORAGE_KEY = 'misfitPresetLibrary';

const makeId = () => {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
        return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const toBaseName = (pathStr: string) => {
    const cleaned = pathStr.replace(/[\\/]+$/, '');
    const base = cleaned.split(/[\\/]/).pop();
    return base || 'file';
};

const stepLabel = (type: StepType) => {
    switch (type) {
        case 'copy':
            return 'Copy Decree';
        case 'patchBlock':
            return 'Patch Decree';
        case 'setJsonValue':
            return 'Set JSON Decree';
        case 'base64Embed':
            return 'Seal Embed';
        case 'runCommand':
            return 'Command Decree';
        default:
            return 'Decree';
    }
};

const createStep = (type: StepType): UiStep => {
    const base = { id: makeId(), enabled: true };
    switch (type) {
        case 'copy':
            return { ...base, type, payloadSource: '', payloadRel: '', dest: '' };
        case 'patchBlock':
            return {
                ...base,
                type,
                file: '',
                startMarker: '',
                endMarker: '',
                contentSource: '',
                contentRel: '',
                replacements: []
            };
        case 'setJsonValue':
            return { ...base, type, file: '', keyPath: '', valueType: 'string', valueRaw: '', valueBool: false };
        case 'base64Embed':
            return { ...base, type, file: '', placeholder: '', inputSource: '', inputRel: '' };
        case 'runCommand':
            return { ...base, type, command: '', args: '' };
        default:
            return { ...base, type: 'copy', payloadSource: '', payloadRel: '', dest: '' };
    }
};

const COMMON_TARGETS = [
    { label: 'Antigravity settings.json (APPDATA)', value: '%APPDATA%\\Antigravity\\User\\settings.json' },
    { label: 'Workbench CSS (LOCALAPPDATA)', value: '%LOCALAPPDATA%\\Programs\\Antigravity\\resources\\app\\out\\vs\\workbench\\workbench.desktop.main.css' },
    { label: 'Jetski CSS (LOCALAPPDATA)', value: '%LOCALAPPDATA%\\Programs\\Antigravity\\resources\\app\\out\\jetskiMain.tailwind.css' },
    { label: 'Extensions path (USERPROFILE)', value: '%USERPROFILE%\\.antigravity\\extensions\\<EXTENSION_NAME>' }
];

const ANTIGRAVITY_FULL_STEPS: InstallStep[] = [
    { type: 'copy', src: 'extensions/antigravity-carbon', dest: '%USERPROFILE%\\.antigravity\\extensions\\antigravity-carbon' },
    { type: 'copy', src: 'extensions/antigravity-carbon-v4', dest: '%USERPROFILE%\\.antigravity\\extensions\\antigravity-carbon-v4' },
    { type: 'copy', src: 'extensions/antigravity-glass-icons', dest: '%USERPROFILE%\\.antigravity\\extensions\\antigravity-glass-icons' },
    { type: 'copy', src: 'extensions/MisfitSanctuaryAnimations', dest: '%USERPROFILE%\\.antigravity\\extensions\\MisfitSanctuaryAnimations' },
    { type: 'copy', src: 'extensions/MisfitSanctuaryTheme', dest: '%USERPROFILE%\\.antigravity\\extensions\\MisfitSanctuaryTheme' },
    { type: 'copy', src: 'extensions/Plnderer.misfitsanctuary-art-ui', dest: '%USERPROFILE%\\.antigravity\\extensions\\Plnderer.misfitsanctuary-art-ui' },
    {
        type: 'patchBlock',
        file: '%LOCALAPPDATA%\\Programs\\Antigravity\\resources\\app\\out\\vs\\workbench\\workbench.desktop.main.css',
        startMarker: '/* MisfitSanctuary.Art UI START */',
        endMarker: '/* MisfitSanctuary.Art UI END */',
        contentFile: 'overlays/workbench.overlay.css'
    },
    {
        type: 'patchBlock',
        file: '%LOCALAPPDATA%\\Programs\\Antigravity\\resources\\app\\out\\jetskiMain.tailwind.css',
        startMarker: '/* MisfitSanctuary.Art UI JETSKI START */',
        endMarker: '/* MisfitSanctuary.Art UI JETSKI END */',
        contentFile: 'overlays/jetski.overlay.css'
    },
    {
        type: 'setJsonValue',
        file: '%APPDATA%\\Antigravity\\User\\settings.json',
        keyPath: 'workbench\\.colorTheme',
        value: 'MisfitSanctuary.Art UI'
    },
    {
        type: 'setJsonValue',
        file: '%APPDATA%\\Antigravity\\User\\settings.json',
        keyPath: 'workbench\\.iconTheme',
        value: 'misfit-glass'
    },
    {
        type: 'setJsonValue',
        file: '%APPDATA%\\Antigravity\\User\\settings.json',
        keyPath: 'workbench\\.productIconTheme',
        value: 'misfit-carbon'
    },
    {
        type: 'setJsonValue',
        file: '%APPDATA%\\Antigravity\\User\\settings.json',
        keyPath: 'workbench\\.colorCustomizations',
        value: {
            'editor.background': '#05050500',
            'terminal.background': '#05050500',
            'panel.background': '#05050500',
            'sideBar.background': '#05050500',
            'activityBar.background': '#05050500',
            'statusBar.background': '#05050500',
            'titleBar.activeBackground': '#05050500',
            'titleBar.inactiveBackground': '#05050500',
            'tab.activeBackground': '#05050540',
            'tab.inactiveBackground': '#05050520',
            'tab.unfocusedActiveBackground': '#05050530',
            'tab.unfocusedInactiveBackground': '#05050518',
            'tab.hoverBackground': '#0a120a33',
            'tab.border': '#7DFB3920',
            'tab.activeBorder': '#7DFB3940',
            'tab.activeBorderTop': '#7DFB3966',
            'tab.unfocusedActiveBorder': '#7DFB3933',
            'tab.unfocusedActiveBorderTop': '#7DFB3940'
        }
    }
];

const ANTIGRAVITY_LITE_STEPS: InstallStep[] = [
    { type: 'copy', src: 'extensions/antigravity-carbon', dest: '%USERPROFILE%\\.antigravity\\extensions\\antigravity-carbon' },
    { type: 'copy', src: 'extensions/antigravity-glass-icons', dest: '%USERPROFILE%\\.antigravity\\extensions\\antigravity-glass-icons' },
    { type: 'copy', src: 'extensions/MisfitSanctuaryTheme', dest: '%USERPROFILE%\\.antigravity\\extensions\\MisfitSanctuaryTheme' },
    ...ANTIGRAVITY_FULL_STEPS.filter(step => step.type !== 'copy')
];

const placeholderPattern = /<[^>]+>/;

const joinPathFragments = (base: string, rel: string) => {
    const baseClean = base.replace(/[\\/]+$/, '');
    const relClean = rel.replace(/^[\\/]+/, '');
    if (!baseClean) return relClean;
    if (!relClean) return baseClean;
    const separator = baseClean.includes('\\') ? '\\' : '/';
    return `${baseClean}${separator}${relClean}`;
};

const resolvePayloadSource = (payloadDir: string | undefined, rel: string | undefined) => {
    const cleanedRel = (rel ?? '').trim();
    if (!payloadDir || !cleanedRel) return '';
    if (placeholderPattern.test(cleanedRel)) return '';
    if (/^[a-zA-Z]:[\\/]/.test(cleanedRel) || cleanedRel.startsWith('\\\\') || cleanedRel.startsWith('/')) {
        return cleanedRel;
    }
    return joinPathFragments(payloadDir, cleanedRel);
};

const isAbsolutePath = (value: string) =>
    /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('\\\\') || value.startsWith('/');

const valueToUi = (value: any) => {
    if (typeof value === 'boolean') {
        return { valueType: 'boolean' as const, valueRaw: '', valueBool: value };
    }
    if (typeof value === 'number') {
        return { valueType: 'number' as const, valueRaw: String(value), valueBool: false };
    }
    if (typeof value === 'string') {
        return { valueType: 'string' as const, valueRaw: value, valueBool: false };
    }
    return { valueType: 'json' as const, valueRaw: JSON.stringify(value ?? null, null, 2), valueBool: false };
};

const manifestStepToUi = (step: InstallStep, payloadDir?: string): UiStep | null => {
    switch (step.type) {
        case 'copy':
            const payloadRel = step.src ?? '';
            return {
                id: makeId(),
                enabled: true,
                type: 'copy',
                payloadSource: resolvePayloadSource(payloadDir, payloadRel),
                payloadRel,
                dest: step.dest ?? ''
            };
        case 'patchBlock': {
            const contentRel = step.contentFile ?? '';
            const replacements = step.replacements && typeof step.replacements === 'object'
                ? Object.entries(step.replacements).map(([key, value]) => ({ key, value: String(value ?? '') }))
                : [];
            return {
                id: makeId(),
                enabled: true,
                type: 'patchBlock',
                file: step.file ?? '',
                startMarker: step.startMarker ?? '',
                endMarker: step.endMarker ?? '',
                contentSource: resolvePayloadSource(payloadDir, contentRel),
                contentRel,
                replacements
            };
        }
        case 'setJsonValue': {
            const { valueType, valueRaw, valueBool } = valueToUi(step.value);
            return {
                id: makeId(),
                enabled: true,
                type: 'setJsonValue',
                file: step.file ?? '',
                keyPath: step.keyPath ?? '',
                valueType,
                valueRaw,
                valueBool
            };
        }
        case 'base64Embed':
            const inputRel = step.inputFile ?? '';
            return {
                id: makeId(),
                enabled: true,
                type: 'base64Embed',
                file: step.file ?? '',
                placeholder: step.placeholder ?? '',
                inputSource: resolvePayloadSource(payloadDir, inputRel),
                inputRel
            };
        case 'runCommand':
            return {
                id: makeId(),
                enabled: true,
                type: 'runCommand',
                command: step.command ?? '',
                args: Array.isArray(step.args) ? step.args.join(', ') : String(step.args ?? '')
            };
        default:
            return null;
    }
};

const uiStepsToPresetSteps = (steps: UiStep[]): PresetStep[] =>
    steps.map(step => {
        const { id, ...rest } = step;
        return rest;
    });

const coercePresetSteps = (steps: unknown): PresetStep[] => {
    if (!Array.isArray(steps)) return [];
    return steps
        .map((step) => {
            if (!step || typeof step !== 'object') return null;
            const raw = step as Record<string, any>;
            const enabled = raw.enabled !== false;

            switch (raw.type) {
                case 'copy':
                    return {
                        type: 'copy',
                        enabled,
                        payloadSource: typeof raw.payloadSource === 'string' ? raw.payloadSource : '',
                        payloadRel: typeof raw.payloadRel === 'string' ? raw.payloadRel : String(raw.src ?? ''),
                        dest: typeof raw.dest === 'string' ? raw.dest : ''
                    };
                case 'patchBlock': {
                    const replacementList = Array.isArray(raw.replacements)
                        ? raw.replacements
                        : raw.replacements && typeof raw.replacements === 'object'
                            ? Object.entries(raw.replacements).map(([key, value]) => ({ key, value }))
                            : [];
                    const replacements = replacementList.map((pair: any) => ({
                        key: String(pair?.key ?? ''),
                        value: String(pair?.value ?? '')
                    }));
                    return {
                        type: 'patchBlock',
                        enabled,
                        file: typeof raw.file === 'string' ? raw.file : '',
                        startMarker: typeof raw.startMarker === 'string' ? raw.startMarker : '',
                        endMarker: typeof raw.endMarker === 'string' ? raw.endMarker : '',
                        contentSource: typeof raw.contentSource === 'string' ? raw.contentSource : '',
                        contentRel: typeof raw.contentRel === 'string' ? raw.contentRel : String(raw.contentFile ?? ''),
                        replacements
                    };
                }
                case 'setJsonValue': {
                    let valueType: SetJsonValueStep['valueType'] = 'string';
                    let valueRaw = '';
                    let valueBool = false;

                    if (typeof raw.valueType === 'string') {
                        if (raw.valueType === 'number' || raw.valueType === 'boolean' || raw.valueType === 'json') {
                            valueType = raw.valueType;
                        }
                    }

                    if ('valueRaw' in raw || 'valueBool' in raw || 'valueType' in raw) {
                        valueRaw = typeof raw.valueRaw === 'string' ? raw.valueRaw : String(raw.valueRaw ?? '');
                        valueBool = Boolean(raw.valueBool);
                    } else if ('value' in raw) {
                        const ui = valueToUi(raw.value);
                        valueType = ui.valueType;
                        valueRaw = ui.valueRaw;
                        valueBool = ui.valueBool;
                    }

                    return {
                        type: 'setJsonValue',
                        enabled,
                        file: typeof raw.file === 'string' ? raw.file : '',
                        keyPath: typeof raw.keyPath === 'string' ? raw.keyPath : '',
                        valueType,
                        valueRaw,
                        valueBool
                    };
                }
                case 'base64Embed':
                    return {
                        type: 'base64Embed',
                        enabled,
                        file: typeof raw.file === 'string' ? raw.file : '',
                        placeholder: typeof raw.placeholder === 'string' ? raw.placeholder : '',
                        inputSource: typeof raw.inputSource === 'string' ? raw.inputSource : '',
                        inputRel: typeof raw.inputRel === 'string' ? raw.inputRel : String(raw.inputFile ?? '')
                    };
                case 'runCommand': {
                    const args = Array.isArray(raw.args)
                        ? raw.args.map((arg: any) => String(arg)).join(', ')
                        : typeof raw.args === 'string'
                            ? raw.args
                            : '';
                    return {
                        type: 'runCommand',
                        enabled,
                        command: typeof raw.command === 'string' ? raw.command : '',
                        args
                    };
                }
                default:
                    return null;
            }
        })
        .filter((step): step is PresetStep => step !== null);
};

const presetStepsToUi = (steps: PresetStep[], payloadDir?: string): UiStep[] =>
    steps.map((step) => {
        const enabled = step.enabled ?? true;
        switch (step.type) {
            case 'copy':
                const payloadRel = step.payloadRel ?? '';
                const rawPayloadSource = (step.payloadSource ?? '').trim();
                const shouldResolve = payloadDir && isAbsolutePath(payloadDir) && (!rawPayloadSource || !isAbsolutePath(rawPayloadSource));
                return {
                    id: makeId(),
                    enabled,
                    type: 'copy',
                    payloadSource: shouldResolve
                        ? resolvePayloadSource(payloadDir, payloadRel)
                        : (rawPayloadSource || resolvePayloadSource(payloadDir, payloadRel)),
                    payloadRel,
                    dest: step.dest ?? ''
                };
            case 'patchBlock':
                const contentRel = step.contentRel ?? '';
                const rawContentSource = (step.contentSource ?? '').trim();
                const shouldResolveContent = payloadDir && isAbsolutePath(payloadDir) && (!rawContentSource || !isAbsolutePath(rawContentSource));
                return {
                    id: makeId(),
                    enabled,
                    type: 'patchBlock',
                    file: step.file ?? '',
                    startMarker: step.startMarker ?? '',
                    endMarker: step.endMarker ?? '',
                    contentSource: shouldResolveContent
                        ? resolvePayloadSource(payloadDir, contentRel)
                        : (rawContentSource || resolvePayloadSource(payloadDir, contentRel)),
                    contentRel,
                    replacements: Array.isArray(step.replacements)
                        ? step.replacements.map(pair => ({ key: String(pair.key ?? ''), value: String(pair.value ?? '') }))
                        : []
                };
            case 'setJsonValue':
                return {
                    id: makeId(),
                    enabled,
                    type: 'setJsonValue',
                    file: step.file ?? '',
                    keyPath: step.keyPath ?? '',
                    valueType: step.valueType ?? 'string',
                    valueRaw: step.valueRaw ?? '',
                    valueBool: Boolean(step.valueBool)
                };
            case 'base64Embed':
                return {
                    id: makeId(),
                    enabled,
                    type: 'base64Embed',
                    file: step.file ?? '',
                    placeholder: step.placeholder ?? '',
                    inputSource: (() => {
                        const rawInputSource = (step.inputSource ?? '').trim();
                        const inputRel = step.inputRel ?? '';
                        const shouldResolveInput = payloadDir && isAbsolutePath(payloadDir) && (!rawInputSource || !isAbsolutePath(rawInputSource));
                        if (shouldResolveInput) {
                            return resolvePayloadSource(payloadDir, inputRel);
                        }
                        return rawInputSource || resolvePayloadSource(payloadDir, inputRel);
                    })(),
                    inputRel: step.inputRel ?? ''
                };
            case 'runCommand':
                return {
                    id: makeId(),
                    enabled,
                    type: 'runCommand',
                    command: step.command ?? '',
                    args: step.args ?? ''
                };
            default:
                return {
                    id: makeId(),
                    enabled,
                    type: 'copy',
                    payloadSource: '',
                    payloadRel: '',
                    dest: ''
                };
        }
    });

const normalizePresetData = (raw: any): PresetData => ({
    appName: typeof raw?.appName === 'string' ? raw.appName : 'My App',
    version: typeof raw?.version === 'string' ? raw.version : '1.0.0',
    publisher: typeof raw?.publisher === 'string' ? raw.publisher : 'Misfit',
    description: typeof raw?.description === 'string' ? raw.description : 'Created with Misfit Studio',
    advancedMode: Boolean(raw?.advancedMode),
    payloadDir: typeof raw?.payloadDir === 'string' ? raw.payloadDir : undefined,
    steps: coercePresetSteps(raw?.steps)
});

const createDefaultPresets = (): Preset[] => {
    const fullSteps = ANTIGRAVITY_FULL_STEPS
        .map(step => manifestStepToUi(step, 'payloads/antigravity'))
        .filter((step): step is UiStep => step !== null);
    const liteSteps = ANTIGRAVITY_LITE_STEPS
        .map(step => manifestStepToUi(step, 'payloads/antigravity'))
        .filter((step): step is UiStep => step !== null);

    return [
        {
            name: 'Antigravity Full',
            data: {
                appName: 'Misfit Vibe Installer',
                version: '1.0.0',
                publisher: 'MisfitSanctuary.Art',
                description: 'Installs the Misfit Vibe extension suite and applies the Antigravity UI overlays.',
                advancedMode: false,
                payloadDir: 'payloads/antigravity',
                steps: uiStepsToPresetSteps(fullSteps)
            }
        },
        {
            name: 'Antigravity Lite',
            data: {
                appName: 'Misfit Vibe Installer',
                version: '1.0.0',
                publisher: 'MisfitSanctuary.Art',
                description: 'Installs the Misfit Vibe extension suite and applies the Antigravity UI overlays.',
                advancedMode: false,
                payloadDir: 'payloads/antigravity',
                steps: uiStepsToPresetSteps(liteSteps)
            }
        },
        {
            name: 'Custom',
            data: {
                appName: 'My App',
                version: '1.0.0',
                publisher: 'Misfit',
                description: 'Created with Misfit Studio',
                advancedMode: false,
                steps: []
            }
        }
    ];
};

const loadPresetLibrary = (): Preset[] => {
    if (typeof localStorage === 'undefined') {
        return createDefaultPresets();
    }
    try {
        const stored = localStorage.getItem(PRESET_STORAGE_KEY);
        if (!stored) return createDefaultPresets();
        const parsed = JSON.parse(stored);
        if (!Array.isArray(parsed)) return createDefaultPresets();
        const normalized = parsed
            .map((preset) => {
                if (!preset || typeof preset !== 'object') return null;
                const raw = preset as Record<string, any>;
                const name = typeof raw.name === 'string' ? raw.name.trim() : '';
                if (!name) return null;
                return { name, data: normalizePresetData(raw.data ?? {}) };
            })
            .filter((preset): preset is Preset => preset !== null);
        return normalized.length ? normalized : createDefaultPresets();
    } catch {
        return createDefaultPresets();
    }
};

const presetFileName = (name: string) => {
    const safe = name.replace(/[^a-zA-Z0-9-_]+/g, '-').replace(/^-+|-+$/g, '');
    return safe || 'misfit-preset';
};

const collectReplacementWarnings = (manifest: InstallManifest) => {
    const warnings: string[] = [];
    if (!manifest || !Array.isArray(manifest.installSteps)) return warnings;
    manifest.installSteps.forEach((step, index) => {
        if (step.type !== 'patchBlock') return;
        if (!step.replacements || typeof step.replacements !== 'object') return;
        for (const [key, value] of Object.entries(step.replacements)) {
            if (typeof value !== 'string') {
                const label = step.file ? ` for ${step.file}` : '';
                warnings.push(
                    `Replacement "${key}"${label} in patch decree ${index + 1} was not a string and was converted.`
                );
            }
        }
    });
    return warnings;
};

export default function Dashboard() {
    const [logs, setLogs] = useState<string[]>([]);
    const logEndRef = useRef<HTMLDivElement>(null);

    // Form State
    const [projectName, setProjectName] = useState('MyNewInstaller');
    const [appName, setAppName] = useState('My App');
    const [version, setVersion] = useState('1.0.0');
    const [publisher, setPublisher] = useState('Misfit');
    const [description, setDescription] = useState('Created with Misfit Studio');
    const [advancedMode, setAdvancedMode] = useState(false);
    const [payloadDir, setPayloadDir] = useState('payloads');
    const [steps, setSteps] = useState<UiStep[]>([]);
    const [newStepType, setNewStepType] = useState<StepType>('copy');
    const [presets, setPresets] = useState<Preset[]>(() => loadPresetLibrary());
    const [selectedPresetName, setSelectedPresetName] = useState('Custom');

    const [building, setBuilding] = useState(false);

    useEffect(() => {
        const unlistenPromise = listen<string>('log', (event) => {
            setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${event.payload}`]);
        });
        return () => { unlistenPromise.then(unlisten => unlisten()); };
    }, []);

    useEffect(() => {
        logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [logs]);

    const selectedPreset = useMemo(
        () => presets.find(preset => preset.name === selectedPresetName) ?? null,
        [presets, selectedPresetName]
    );

    useEffect(() => {
        if (presets.length === 0) return;
        if (!presets.some(preset => preset.name === selectedPresetName)) {
            setSelectedPresetName(presets[0].name);
        }
    }, [presets, selectedPresetName]);

    useEffect(() => {
        if (typeof localStorage === 'undefined') return;
        try {
            localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(presets));
        } catch {
            // Ignore storage failures; presets still live in memory.
        }
    }, [presets]);

    const updateStep = (id: string, patch: Partial<UiStep>) => {
        setSteps(prev => prev.map(step => (step.id === id ? { ...step, ...patch } as UiStep : step)));
    };

    const updateStepFrom = (id: string, updater: (step: UiStep) => UiStep) => {
        setSteps(prev => prev.map(step => (step.id === id ? updater(step) : step)));
    };

    const removeStep = (id: string) => {
        setSteps(prev => prev.filter(step => step.id !== id));
    };

    const addStep = () => {
        setSteps(prev => [...prev, createStep(newStepType)]);
    };

    const pickPath = async (id: string, sourceField: string, relField: string, directory = false) => {
        const selected = await open({ multiple: false, directory });
        if (!selected || Array.isArray(selected)) return;
        updateStepFrom(id, (step) => {
            const next = { ...step } as any;
            next[sourceField] = selected;
            if (!next[relField] || String(next[relField]).trim() === '') {
                next[relField] = toBaseName(selected);
            }
            return next as UiStep;
        });
    };

    const payloadDirValue = payloadDir.trim() || 'payloads';

    const applyPresetData = async (preset: Preset) => {
        const data = preset.data;
        setAppName(data.appName ?? 'My App');
        setVersion(data.version ?? '1.0.0');
        setPublisher(data.publisher ?? 'Misfit');
        setDescription(data.description ?? 'Created with Misfit Studio');
        setAdvancedMode(Boolean(data.advancedMode));
        const nextPayloadDir = data.payloadDir
            ?? (preset.name.toLowerCase().includes('antigravity') ? 'payloads/antigravity' : payloadDirValue);
        setPayloadDir(nextPayloadDir);
        let payloadBase = nextPayloadDir;
        try {
            const resolved = await invoke<string | null>('resolve_payload_root', { payloadDir: nextPayloadDir });
            if (resolved) {
                payloadBase = resolved;
            }
        } catch {
            // Ignore auto-resolve failures and fall back to the preset payloadDir.
        }
        setSteps(presetStepsToUi(coercePresetSteps(data.steps), payloadBase));
    };

    const handleApplyPreset = async () => {
        if (!selectedPreset) {
            setLogs(p => [...p, 'No preset selected.']);
            return;
        }
        if (steps.length > 0) {
            const confirmOverwrite = await confirm(
                'Overwrite the current decrees with the selected preset?',
                { title: 'Apply preset', kind: 'warning' }
            );
            if (!confirmOverwrite) return;
        }
        await applyPresetData(selectedPreset);
        setLogs(p => [...p, `Preset applied: ${selectedPreset.name}`]);
    };

    const handleSavePreset = async () => {
        const suggested = selectedPreset?.name ?? '';
        const nameInput = window.prompt('Name this preset for the royal library.', suggested);
        const name = (nameInput ?? '').trim();
        if (!name) return;

        const existing = presets.find(preset => preset.name === name);
        if (existing) {
            const overwrite = await confirm(
                `A preset named "${name}" already exists. Replace it?`,
                { title: 'Replace preset?', kind: 'warning' }
            );
            if (!overwrite) return;
        }

        const data: PresetData = {
            appName,
            version,
            publisher,
            description,
            advancedMode,
            payloadDir: payloadDirValue,
            steps: uiStepsToPresetSteps(steps)
        };

        setPresets(prev => {
            const next = prev.filter(preset => preset.name !== name);
            return [...next, { name, data }];
        });
        setSelectedPresetName(name);
        setLogs(p => [...p, `Preset saved: ${name}`]);
    };

    const handleDeletePreset = async () => {
        if (!selectedPreset) {
            setLogs(p => [...p, 'No preset selected.']);
            return;
        }
        if (presets.length <= 1) {
            setLogs(p => [...p, 'The library needs at least one preset.']);
            return;
        }
        const confirmDelete = await confirm(
            `Dismiss the preset "${selectedPreset.name}" from the library?`,
            { title: 'Delete preset?', kind: 'warning' }
        );
        if (!confirmDelete) return;
        setPresets(prev => prev.filter(preset => preset.name !== selectedPreset.name));
        setLogs(p => [...p, `Preset deleted: ${selectedPreset.name}`]);
    };

    const handleImportPreset = async () => {
        const selected = await open({
            multiple: false,
            filters: [{ name: 'Misfit Preset', extensions: ['json'] }]
        });
        if (!selected || Array.isArray(selected)) return;
        try {
            const text = await invoke<string>('read_text_file', { path: selected });
            const parsed = JSON.parse(text);
            const name = typeof parsed?.name === 'string' ? parsed.name.trim() : '';
            if (!name) {
                throw new Error('Preset name is missing.');
            }
            const data = normalizePresetData(parsed.data ?? {});
            const existing = presets.find(preset => preset.name === name);
            if (existing) {
                const overwrite = await confirm(
                    `A preset named "${name}" already exists. Replace it?`,
                    { title: 'Replace preset?', kind: 'warning' }
                );
                if (!overwrite) return;
            }
            setPresets(prev => {
                const next = prev.filter(preset => preset.name !== name);
                return [...next, { name, data }];
            });
            setSelectedPresetName(name);
            setLogs(p => [...p, `Preset imported: ${name}`]);
        } catch (e) {
            setLogs(p => [...p, `Preset import failed: ${String(e)}`]);
        }
    };

    const handleExportPreset = async () => {
        if (!selectedPreset) {
            setLogs(p => [...p, 'No preset selected.']);
            return;
        }
        const filePath = await save({
            defaultPath: `${presetFileName(selectedPreset.name)}.misfit-preset.json`,
            filters: [{ name: 'Misfit Preset', extensions: ['json'] }]
        });
        if (!filePath) return;
        try {
            const payload = {
                name: selectedPreset.name,
                data: selectedPreset.data
            };
            const json = JSON.stringify(payload, null, 2);
            await invoke('write_text_file', { path: filePath, contents: json });
            setLogs(p => [...p, `Preset exported to ${filePath}`]);
        } catch (e) {
            setLogs(p => [...p, `Preset export failed: ${String(e)}`]);
        }
    };

    const handleScanExtensions = async () => {
        const selected = await open({ multiple: false, directory: true });
        if (!selected || Array.isArray(selected)) return;
        try {
            const entries = await invoke<ScanEntry[]>('scan_extension_folders', { root: selected });
            if (!entries.length) {
                setLogs(p => [...p, 'No extension folders found in the selected directory.']);
                return;
            }
            const newSteps = entries.map(entry => ({
                id: makeId(),
                enabled: true,
                type: 'copy' as const,
                payloadSource: entry.path,
                payloadRel: `extensions/${entry.name}`,
                dest: `%USERPROFILE%\\.antigravity\\extensions\\${entry.name}`
            }));
            setSteps(prev => [...prev, ...newSteps]);
            setLogs(p => [...p, `Loaded ${entries.length} extension copy decrees.`]);
        } catch (e) {
            setLogs(p => [...p, `Scan failed: ${String(e)}`]);
        }
    };

    const applyManifest = (manifest: InstallManifest) => {
        setAppName(manifest.appName ?? 'My App');
        setVersion(manifest.version ?? '1.0.0');
        setPublisher(manifest.publisher ?? 'Misfit');
        setDescription(manifest.description ?? 'Created with Misfit Studio');
        setAdvancedMode(Boolean(manifest.advancedMode));
        setPayloadDir(manifest.payloadDir ?? 'payloads');
        const incoming = Array.isArray(manifest.installSteps)
            ? manifest.installSteps
                .map(step => manifestStepToUi(step, manifest.payloadDir ?? 'payloads'))
                .filter((step): step is UiStep => step !== null)
            : [];
        setSteps(incoming);
    };

    const handleImportManifest = async () => {
        const selected = await open({
            multiple: false,
            filters: [{ name: 'Manifest JSON', extensions: ['json'] }]
        });
        if (!selected || Array.isArray(selected)) return;
        try {
            const text = await invoke<string>('read_text_file', { path: selected });
            const parsed = JSON.parse(text) as InstallManifest;
            const warnings = collectReplacementWarnings(parsed);
            applyManifest(parsed);
            setLogs(p => [
                ...p,
                `Manifest imported from ${selected}`,
                ...warnings.map(warning => `Warning: ${warning}`)
            ]);
        } catch (e) {
            setLogs(p => [...p, `Manifest import failed: ${String(e)}`]);
        }
    };

    const buildManifestForExport = () => {
        const installSteps: InstallStep[] = [];

        for (const step of steps) {
            if (!step.enabled) continue;

            if (step.type === 'copy') {
                const rel = step.payloadRel.trim() || (step.payloadSource ? toBaseName(step.payloadSource) : '');
                if (!rel && !step.dest.trim()) continue;
                installSteps.push({ type: 'copy', src: rel, dest: step.dest.trim() });
            }

            if (step.type === 'patchBlock') {
                if (!step.file.trim() && !step.contentRel.trim() && !step.contentSource.trim()) continue;
                const rel = step.contentRel.trim() || (step.contentSource ? toBaseName(step.contentSource) : '');
                const replacements = step.replacements
                    .filter(pair => pair.key.trim().length > 0)
                    .reduce((acc, pair) => {
                        acc[pair.key] = pair.value;
                        return acc;
                    }, {} as Record<string, string>);
                installSteps.push({
                    type: 'patchBlock',
                    file: step.file.trim(),
                    startMarker: step.startMarker.trim(),
                    endMarker: step.endMarker.trim(),
                    contentFile: rel,
                    replacements: Object.keys(replacements).length ? replacements : undefined
                });
            }

            if (step.type === 'setJsonValue') {
                if (!step.file.trim() && !step.keyPath.trim() && !step.valueRaw.trim()) continue;
                let value: any = step.valueRaw;
                if (step.valueType === 'number') {
                    const parsed = Number(step.valueRaw);
                    value = Number.isNaN(parsed) ? step.valueRaw : parsed;
                } else if (step.valueType === 'boolean') {
                    value = step.valueBool;
                } else if (step.valueType === 'json') {
                    try {
                        value = JSON.parse(step.valueRaw || 'null');
                    } catch {
                        value = step.valueRaw;
                    }
                }
                installSteps.push({
                    type: 'setJsonValue',
                    file: step.file.trim(),
                    keyPath: step.keyPath.trim(),
                    value
                });
            }

            if (step.type === 'base64Embed') {
                if (!step.file.trim() && !step.inputRel.trim() && !step.inputSource.trim()) continue;
                const rel = step.inputRel.trim() || (step.inputSource ? toBaseName(step.inputSource) : '');
                installSteps.push({
                    type: 'base64Embed',
                    file: step.file.trim(),
                    placeholder: step.placeholder.trim(),
                    inputFile: rel
                });
            }

            if (step.type === 'runCommand') {
                if (!step.command.trim() && !step.args.trim()) continue;
                const args = step.args
                    .split(',')
                    .map(arg => arg.trim())
                    .filter(Boolean);
                installSteps.push({ type: 'runCommand', command: step.command.trim(), args });
            }
        }

        return {
            appName,
            version,
            publisher,
            description,
            advancedMode,
            targets: [],
            payloadDir: payloadDirValue,
            installSteps
        };
    };

    const handleExportManifest = async () => {
        const filePath = await save({
            defaultPath: 'install.manifest.json',
            filters: [{ name: 'Manifest JSON', extensions: ['json'] }]
        });
        if (!filePath) return;
        try {
            const manifest = buildManifestForExport();
            const json = JSON.stringify(manifest, null, 2);
            await invoke('write_text_file', { path: filePath, contents: json });
            setLogs(p => [...p, `Manifest exported to ${filePath}`]);
        } catch (e) {
            setLogs(p => [...p, `Manifest export failed: ${String(e)}`]);
        }
    };

    const formatJsonValue = (id: string) => {
        const target = steps.find(step => step.id === id);
        if (!target || target.type !== 'setJsonValue' || target.valueType !== 'json') return;
        try {
            const parsed = JSON.parse(target.valueRaw || 'null');
            updateStep(id, { valueRaw: JSON.stringify(parsed, null, 2) });
        } catch {
            setLogs(p => [...p, 'JSON helper: invalid JSON, cannot format.']);
        }
    };

    const validation = useMemo(() => {
        const issueMap = new Map<string, StepIssue[]>();
        let errorCount = 0;
        let warningCount = 0;

        const pushIssue = (id: string, level: IssueLevel, message: string) => {
            const list = issueMap.get(id) ?? [];
            list.push({ level, message });
            issueMap.set(id, list);
            if (level === 'error') {
                errorCount += 1;
            } else {
                warningCount += 1;
            }
        };

        for (const step of steps) {
            if (!step.enabled) continue;

            if (step.type === 'copy') {
                if (!step.payloadSource.trim()) {
                    pushIssue(step.id, 'error', 'Copy decree is missing a source.');
                }
                if (!step.dest.trim()) {
                    pushIssue(step.id, 'error', 'Copy decree is missing a destination path.');
                }
                if (placeholderPattern.test(step.dest)) {
                    pushIssue(step.id, 'warning', 'Destination path contains a placeholder.');
                }
            }

            if (step.type === 'patchBlock') {
                if (!step.file.trim()) {
                    pushIssue(step.id, 'error', 'Patch decree is missing the target file.');
                }
                if (!step.startMarker.trim() || !step.endMarker.trim()) {
                    pushIssue(step.id, 'error', 'Patch decree needs both start/end markers.');
                }
                if (!step.contentSource.trim()) {
                    pushIssue(step.id, 'error', 'Patch decree is missing a content file.');
                }
                if (placeholderPattern.test(step.file)) {
                    pushIssue(step.id, 'warning', 'Target file contains a placeholder.');
                }
            }

            if (step.type === 'setJsonValue') {
                if (!step.file.trim()) {
                    pushIssue(step.id, 'error', 'JSON decree is missing the target file.');
                }
                if (step.file && !step.file.trim().toLowerCase().endsWith('.json')) {
                    pushIssue(step.id, 'warning', 'JSON decree target does not end in .json.');
                }
                if (!step.keyPath.trim()) {
                    pushIssue(step.id, 'error', 'JSON decree is missing the key path.');
                }
                if (step.valueType === 'number') {
                    const parsed = Number(step.valueRaw);
                    if (Number.isNaN(parsed)) {
                        pushIssue(step.id, 'error', 'JSON number value is invalid.');
                    }
                }
                if (step.valueType === 'json') {
                    try {
                        JSON.parse(step.valueRaw || 'null');
                    } catch {
                        pushIssue(step.id, 'error', 'JSON value is not valid JSON.');
                    }
                }
                if (placeholderPattern.test(step.file)) {
                    pushIssue(step.id, 'warning', 'JSON target file contains a placeholder.');
                }
            }

            if (step.type === 'base64Embed') {
                if (!step.file.trim()) {
                    pushIssue(step.id, 'error', 'Seal embed is missing the target file.');
                }
                if (!step.placeholder.trim()) {
                    pushIssue(step.id, 'error', 'Seal embed is missing the placeholder.');
                }
                if (!step.inputSource.trim()) {
                    pushIssue(step.id, 'error', 'Seal embed is missing the input file.');
                }
                if (placeholderPattern.test(step.file)) {
                    pushIssue(step.id, 'warning', 'Embed target file contains a placeholder.');
                }
            }

            if (step.type === 'runCommand') {
                if (!step.command.trim()) {
                    pushIssue(step.id, 'error', 'Command decree is missing the command.');
                }
            }
        }

        return { issueMap, errorCount, warningCount };
    }, [steps]);

    const handleBuild = async () => {
        setBuilding(true);
        setLogs(p => [...p, 'Summoning the forge...']);

        try {
            const payloadMap = new Map<string, string>();
            const installSteps: InstallStep[] = [];
            const errors: string[] = [];

            const addPayload = (rel: string, source: string) => {
                const cleaned = rel.trim();
                if (!cleaned) {
                    errors.push('A payload path cannot be empty.');
                    return;
                }
                if (payloadMap.has(cleaned) && payloadMap.get(cleaned) !== source) {
                    errors.push(`A payload path is already claimed: ${cleaned}`);
                    return;
                }
                payloadMap.set(cleaned, source);
            };

            for (const step of steps) {
                if (!step.enabled) continue;

                if (step.type === 'copy') {
                    const source = step.payloadSource.trim();
                    const dest = step.dest.trim();
                    if (!source) {
                        errors.push('A copy decree is missing a source file or folder.');
                        continue;
                    }
                    if (!dest) {
                        errors.push('A copy decree is missing a destination path.');
                        continue;
                    }
                    const rel = step.payloadRel.trim() || toBaseName(source);
                    addPayload(rel, source);
                    installSteps.push({ type: 'copy', src: rel, dest });
                }

                if (step.type === 'patchBlock') {
                    const target = step.file.trim();
                    const startMarker = step.startMarker.trim();
                    const endMarker = step.endMarker.trim();
                    const contentSource = step.contentSource.trim();
                    if (!target) {
                        errors.push('A patch decree is missing the target file.');
                        continue;
                    }
                    if (!startMarker) {
                        errors.push('A patch decree is missing a start marker.');
                        continue;
                    }
                    if (!endMarker) {
                        errors.push('A patch decree is missing an end marker.');
                        continue;
                    }
                    if (!contentSource) {
                        errors.push('A patch decree is missing a content file.');
                        continue;
                    }
                    const rel = step.contentRel.trim() || toBaseName(contentSource);
                    addPayload(rel, contentSource);
                    const replacements = step.replacements
                        .filter(pair => pair.key.trim().length > 0)
                        .reduce((acc, pair) => {
                            acc[pair.key] = pair.value;
                            return acc;
                        }, {} as Record<string, string>);
                    installSteps.push({
                        type: 'patchBlock',
                        file: target,
                        startMarker,
                        endMarker,
                        contentFile: rel,
                        replacements: Object.keys(replacements).length ? replacements : undefined
                    });
                }

                if (step.type === 'setJsonValue') {
                    const target = step.file.trim();
                    const keyPath = step.keyPath.trim();
                    if (!target) {
                        errors.push('A JSON decree is missing the target file.');
                        continue;
                    }
                    if (!keyPath) {
                        errors.push('A JSON decree is missing the key path.');
                        continue;
                    }
                    let value: any = step.valueRaw;
                    if (step.valueType === 'number') {
                        const parsed = Number(step.valueRaw);
                        if (Number.isNaN(parsed)) {
                            errors.push('A JSON decree number is invalid.');
                            continue;
                        }
                        value = parsed;
                    } else if (step.valueType === 'boolean') {
                        value = step.valueBool;
                    } else if (step.valueType === 'json') {
                        try {
                            value = JSON.parse(step.valueRaw || 'null');
                        } catch {
                            errors.push('A JSON decree is not valid JSON.');
                            continue;
                        }
                    }
                    installSteps.push({
                        type: 'setJsonValue',
                        file: target,
                        keyPath,
                        value
                    });
                }

                if (step.type === 'base64Embed') {
                    const target = step.file.trim();
                    const placeholder = step.placeholder.trim();
                    const inputSource = step.inputSource.trim();
                    if (!target) {
                        errors.push('A seal embed decree is missing the target file.');
                        continue;
                    }
                    if (!placeholder) {
                        errors.push('A seal embed decree is missing the placeholder.');
                        continue;
                    }
                    if (!inputSource) {
                        errors.push('A seal embed decree is missing the input file.');
                        continue;
                    }
                    const rel = step.inputRel.trim() || toBaseName(inputSource);
                    addPayload(rel, inputSource);
                    installSteps.push({
                        type: 'base64Embed',
                        file: target,
                        placeholder,
                        inputFile: rel
                    });
                }

                if (step.type === 'runCommand') {
                    const command = step.command.trim();
                    if (!command) {
                        errors.push('A command decree is missing the command.');
                        continue;
                    }
                    const args = step.args
                        .split(',')
                        .map(arg => arg.trim())
                        .filter(Boolean);
                    installSteps.push({ type: 'runCommand', command, args });
                }
            }

            if (errors.length) {
                throw new Error(errors.join(' '));
            }

            const manifest: InstallManifest = {
                appName,
                version,
                publisher,
                description,
                advancedMode,
                targets: [],
                payloadDir: payloadDirValue,
                installSteps
            };

            const payloadFiles: [string, string][] = Array.from(payloadMap.entries()).map(([rel, src]) => [src, rel]);

            const inspectReq: BuildRequest = {
                projectName,
                manifest,
                payloadFiles
            };
            const target = await invoke<BuildTargetInfo>('inspect_build_target', { request: inspectReq });

            let forceOverwrite = false;
            if (target.exists) {
                if (target.isAbsolute && !target.hasMarker) {
                    const warn = await confirm(
                        `The output folder exists but does not contain a .misfit-studio marker:\n${target.path}\n\nDo you want to continue?`,
                        { title: 'No marker found', kind: 'warning' }
                    );
                    if (!warn) {
                        setBuilding(false);
                        return;
                    }
                    const confirmDelete = await confirm(
                        'This will delete the entire folder and its contents before building the new installer. Continue?',
                        { title: 'Delete existing folder?', kind: 'warning' }
                    );
                    if (!confirmDelete) {
                        setBuilding(false);
                        return;
                    }
                    forceOverwrite = true;
                } else {
                    const confirmDelete = await confirm(
                        `The output folder already exists:\n${target.path}\n\nDo you want to replace it?`,
                        { title: 'Overwrite existing build?', kind: 'warning' }
                    );
                    if (!confirmDelete) {
                        setBuilding(false);
                        return;
                    }
                    forceOverwrite = true;
                }
            }

            const req: BuildRequest = {
                projectName,
                manifest,
                payloadFiles,
                forceOverwrite
            };

            const path = await invoke('build_project', { request: req });
            setLogs(p => [...p, `Decree forged. Output at: ${path}`]);
        } catch (e) {
            setLogs(p => [...p, `Forge failed: ${String(e)}`]);
        } finally {
            setBuilding(false);
        }
    };

    return (
        <div className="studio-page">
            <div className="studio-shell">
                <aside className="studio-hero">
                    <div className="hero-badge">Misfit Studio</div>
                    <h1 className="studio-title">Misfit Studio</h1>
                    <p className="studio-tagline">
                        Forge installer decrees with safeguarded defaults, noble branding, and a trusted restore path.
                    </p>
                    <div className="hero-cards">
                        <div className="hero-card">
                            <h3>Safeguarded by decree</h3>
                            <p>Automatic backups and a restore map before any changes.</p>
                        </div>
                        <div className="hero-card">
                            <h3>Edict-driven</h3>
                            <p>Swap branding and install logic without touching code.</p>
                        </div>
                        <div className="hero-card">
                            <h3>From court to ship</h3>
                            <p>Build a portable installer bundle with one click.</p>
                        </div>
                    </div>
                    <div className="hero-foot">
                        Tip: Royal Override allows absolute output paths and one-shot patching.
                    </div>
                </aside>

                <section className="studio-form">
                    <div className="form-header">
                        <h2>Royal Decree</h2>
                        <p>Declare the realm's basics, then craft your installation decrees.</p>
                    </div>

                    <div className="form-grid">
                        <label className="field">
                            <span>Realm Name (Folder Name, or Absolute Path in Royal Override)</span>
                            <input type="text" value={projectName} onChange={e => setProjectName(e.target.value)} />
                            <span className="hint">Defaults to dist/ in your realm archive.</span>
                        </label>

                        <label className="field">
                            <span>Payload Folder (inside the build output)</span>
                            <input type="text" value={payloadDir} onChange={e => setPayloadDir(e.target.value)} />
                            <span className="hint">Use a relative path like payloads/antigravity.</span>
                        </label>

                        <label className="field">
                            <span>App Name (Shown to Subjects)</span>
                            <input type="text" value={appName} onChange={e => setAppName(e.target.value)} />
                        </label>

                        <label className="field">
                            <span>Edition</span>
                            <input type="text" value={version} onChange={e => setVersion(e.target.value)} />
                        </label>

                        <label className="field">
                            <span>Patron</span>
                            <input type="text" value={publisher} onChange={e => setPublisher(e.target.value)} />
                        </label>

                        <label className="field field-full">
                            <span>Royal Proclamation</span>
                            <textarea value={description} onChange={e => setDescription(e.target.value)} />
                        </label>

                        <label className="toggle">
                            <input type="checkbox" checked={advancedMode} onChange={e => setAdvancedMode(e.target.checked)} />
                            Royal Override (allow absolute output path, one-shot patching)
                        </label>
                    </div>

                    <div className="panel preset-panel">
                        <div className="preset-header">
                            <h3>Preset Library</h3>
                            <p className="hint">Curate reusable recipes to summon decrees in a single breath.</p>
                        </div>
                        <div className="preset-grid">
                            <label className="field">
                                <span>Preset Library</span>
                                <select
                                    value={selectedPresetName}
                                    onChange={e => setSelectedPresetName(e.target.value)}
                                >
                                    {presets.map(preset => (
                                        <option key={preset.name} value={preset.name}>
                                            {preset.name}
                                        </option>
                                    ))}
                                </select>
                                <span className="hint">Presets are reusable recipes you can summon again.</span>
                            </label>
                            <div className="preset-actions">
                                <button className="btn-ghost" type="button" onClick={handleApplyPreset}>
                                    Apply Preset
                                </button>
                                <button className="btn-ghost" type="button" onClick={handleSavePreset}>
                                    Save Current as Preset
                                </button>
                                <button className="btn-ghost" type="button" onClick={handleDeletePreset}>
                                    Delete Preset
                                </button>
                                <button className="btn-ghost" type="button" onClick={handleImportPreset}>
                                    Import Preset
                                </button>
                                <button className="btn-ghost" type="button" onClick={handleExportPreset}>
                                    Export Preset
                                </button>
                            </div>
                        </div>
                        <div className="preset-advanced">
                            <div className="preset-advanced-title">Advanced</div>
                            <div className="preset-advanced-actions">
                                <button className="btn-ghost" type="button" onClick={handleScanExtensions}>
                                    Scan Extensions Folder
                                </button>
                                <button className="btn-ghost" type="button" onClick={handleImportManifest}>
                                    Import Manifest
                                </button>
                                <button className="btn-ghost" type="button" onClick={handleExportManifest}>
                                    Export Manifest
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="panel steps-panel">
                        <div className="steps-header">
                            <div>
                                <h3>Royal Decrees</h3>
                                <p className="hint">Add each action and attach payload files to the decree.</p>
                            </div>
                            <div className="steps-actions">
                                <select value={newStepType} onChange={e => setNewStepType(e.target.value as StepType)}>
                                    <option value="copy">Copy</option>
                                    <option value="patchBlock">Patch Block</option>
                                    <option value="setJsonValue">Set JSON Value</option>
                                    <option value="base64Embed">Base64 Embed</option>
                                    <option value="runCommand">Run Command</option>
                                </select>
                                <button className="btn-secondary" type="button" onClick={addStep}>
                                    Add Decree
                                </button>
                            </div>
                            <div className="validation-summary">
                                {validation.errorCount > 0 && (
                                    <span className="issue-pill error">{validation.errorCount} error{validation.errorCount === 1 ? '' : 's'}</span>
                                )}
                                {validation.warningCount > 0 && (
                                    <span className="issue-pill warning">{validation.warningCount} warning{validation.warningCount === 1 ? '' : 's'}</span>
                                )}
                                {validation.errorCount === 0 && validation.warningCount === 0 && (
                                    <span className="issue-pill ok">All clear</span>
                                )}
                            </div>
                        </div>

                        <div className="steps-list">
                            {steps.length === 0 && (
                                <div className="empty-steps">No decrees yet. Add one to begin forging.</div>
                            )}

                            {steps.map((step, index) => {
                                const issues = validation.issueMap.get(step.id) ?? [];
                                const hasError = issues.some(issue => issue.level === 'error');
                                const hasWarning = issues.some(issue => issue.level === 'warning');
                                return (
                                    <div
                                        className={`step-card${hasError ? ' has-error' : ''}${!hasError && hasWarning ? ' has-warning' : ''}`}
                                        key={step.id}
                                    >
                                        <div className="step-head">
                                            <div className="step-title">
                                                <span className="step-badge">{index + 1}</span>
                                                <h4>{stepLabel(step.type)}</h4>
                                            </div>
                                            <div className="step-controls">
                                                <label className="mini-toggle">
                                                    <input
                                                        type="checkbox"
                                                        checked={step.enabled}
                                                        onChange={e => updateStep(step.id, { enabled: e.target.checked })}
                                                    />
                                                    Enabled
                                                </label>
                                                <button className="btn-ghost" type="button" onClick={() => removeStep(step.id)}>
                                                    Remove
                                                </button>
                                            </div>
                                        </div>

                                        {step.type === 'copy' && (
                                            <div className="step-body">
                                                <label className="field">
                                                    <span>Payload Source (File or Folder)</span>
                                                    <div className="file-row">
                                                        <input
                                                            type="text"
                                                            value={step.payloadSource}
                                                            placeholder="C:\\path\\to\\file-or-folder"
                                                            onChange={e => updateStep(step.id, { payloadSource: e.target.value })}
                                                        />
                                                        <button
                                                            className="btn-ghost"
                                                            type="button"
                                                            onClick={() => pickPath(step.id, 'payloadSource', 'payloadRel', false)}
                                                        >
                                                            Pick File
                                                        </button>
                                                        <button
                                                            className="btn-ghost"
                                                            type="button"
                                                            onClick={() => pickPath(step.id, 'payloadSource', 'payloadRel', true)}
                                                        >
                                                            Pick Folder
                                                        </button>
                                                    </div>
                                                </label>
                                                <div className="step-grid">
                                                    <label className="field">
                                                        <span>Payload Path (inside payloads/)</span>
                                                        <input
                                                            type="text"
                                                            value={step.payloadRel}
                                                            placeholder="theme/styles.css"
                                                            onChange={e => updateStep(step.id, { payloadRel: e.target.value })}
                                                        />
                                                    </label>
                                                    <label className="field">
                                                        <span>Destination Path (Relative to Target)</span>
                                                        <input
                                                            type="text"
                                                            value={step.dest}
                                                            placeholder="themes/styles.css"
                                                            onChange={e => updateStep(step.id, { dest: e.target.value })}
                                                        />
                                                        <select
                                                            className="path-helper"
                                                            onChange={e => updateStep(step.id, { dest: e.target.value })}
                                                        >
                                                            <option value="">Path helper...</option>
                                                            {COMMON_TARGETS.map(option => (
                                                                <option key={`copy-dest-${option.value}`} value={option.value}>
                                                                    {option.label}
                                                                </option>
                                                            ))}
                                                        </select>
                                                    </label>
                                                </div>
                                            </div>
                                        )}

                                        {step.type === 'patchBlock' && (
                                            <div className="step-body">
                                                <div className="step-grid">
                                                    <label className="field">
                                                        <span>Target File (Relative to Manifest)</span>
                                                        <input
                                                            type="text"
                                                            value={step.file}
                                                            placeholder="styles/app.css"
                                                            onChange={e => updateStep(step.id, { file: e.target.value })}
                                                        />
                                                        <select
                                                            className="path-helper"
                                                            onChange={e => updateStep(step.id, { file: e.target.value })}
                                                        >
                                                            <option value="">Path helper...</option>
                                                            {COMMON_TARGETS.map(option => (
                                                                <option key={`patch-file-${option.value}`} value={option.value}>
                                                                    {option.label}
                                                                </option>
                                                            ))}
                                                        </select>
                                                    </label>
                                                    <label className="field">
                                                        <span>Start Marker</span>
                                                        <input
                                                            type="text"
                                                            value={step.startMarker}
                                                            placeholder="/* START MISFIT */"
                                                            onChange={e => updateStep(step.id, { startMarker: e.target.value })}
                                                        />
                                                    </label>
                                                    <label className="field">
                                                        <span>End Marker</span>
                                                        <input
                                                            type="text"
                                                            value={step.endMarker}
                                                            placeholder="/* END MISFIT */"
                                                            onChange={e => updateStep(step.id, { endMarker: e.target.value })}
                                                        />
                                                    </label>
                                                </div>

                                                <label className="field">
                                                    <span>Patch Content File (Payload)</span>
                                                    <div className="file-row">
                                                        <input
                                                            type="text"
                                                            value={step.contentSource}
                                                            placeholder="C:\\path\\to\\patch.css"
                                                            onChange={e => updateStep(step.id, { contentSource: e.target.value })}
                                                        />
                                                        <button
                                                            className="btn-ghost"
                                                            type="button"
                                                            onClick={() => pickPath(step.id, 'contentSource', 'contentRel', false)}
                                                        >
                                                            Pick File
                                                        </button>
                                                    </div>
                                                </label>
                                                <label className="field">
                                                    <span>Payload Path (inside payloads/)</span>
                                                    <input
                                                        type="text"
                                                        value={step.contentRel}
                                                        placeholder="patches/theme.css"
                                                        onChange={e => updateStep(step.id, { contentRel: e.target.value })}
                                                    />
                                                </label>

                                                <div className="replacements">
                                                    <div className="replacements-head">
                                                        <span>Replacements</span>
                                                        <button
                                                            className="btn-ghost"
                                                            type="button"
                                                            onClick={() =>
                                                                updateStepFrom(step.id, (curr) => {
                                                                    if (curr.type !== 'patchBlock') return curr;
                                                                    return {
                                                                        ...curr,
                                                                        replacements: [...curr.replacements, { key: '', value: '' }]
                                                                    };
                                                                })
                                                            }
                                                        >
                                                            Add Replacement
                                                        </button>
                                                    </div>
                                                    {step.replacements.length === 0 && (
                                                        <div className="hint">No replacements yet.</div>
                                                    )}
                                                    {step.replacements.map((pair, idx) => (
                                                        <div className="replacement-row" key={`${step.id}-rep-${idx}`}>
                                                            <input
                                                                type="text"
                                                                placeholder="{{token}}"
                                                                value={pair.key}
                                                                onChange={e =>
                                                                    updateStepFrom(step.id, (curr) => {
                                                                        if (curr.type !== 'patchBlock') return curr;
                                                                        const next = [...curr.replacements];
                                                                        next[idx] = { ...next[idx], key: e.target.value };
                                                                        return { ...curr, replacements: next };
                                                                    })
                                                                }
                                                            />
                                                            <input
                                                                type="text"
                                                                placeholder="replacement value"
                                                                value={pair.value}
                                                                onChange={e =>
                                                                    updateStepFrom(step.id, (curr) => {
                                                                        if (curr.type !== 'patchBlock') return curr;
                                                                        const next = [...curr.replacements];
                                                                        next[idx] = { ...next[idx], value: e.target.value };
                                                                        return { ...curr, replacements: next };
                                                                    })
                                                                }
                                                            />
                                                            <button
                                                                className="btn-ghost"
                                                                type="button"
                                                                onClick={() =>
                                                                    updateStepFrom(step.id, (curr) => {
                                                                        if (curr.type !== 'patchBlock') return curr;
                                                                        const next = curr.replacements.filter((_, i) => i !== idx);
                                                                        return { ...curr, replacements: next };
                                                                    })
                                                                }
                                                            >
                                                                Remove
                                                            </button>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {step.type === 'setJsonValue' && (
                                            <div className="step-body">
                                                <div className="step-grid">
                                                    <label className="field">
                                                        <span>Target JSON File</span>
                                                        <input
                                                            type="text"
                                                            value={step.file}
                                                            placeholder="config/settings.json"
                                                            onChange={e => updateStep(step.id, { file: e.target.value })}
                                                        />
                                                        <select
                                                            className="path-helper"
                                                            onChange={e => updateStep(step.id, { file: e.target.value })}
                                                        >
                                                            <option value="">Path helper...</option>
                                                            {COMMON_TARGETS.map(option => (
                                                                <option key={`json-file-${option.value}`} value={option.value}>
                                                                    {option.label}
                                                                </option>
                                                            ))}
                                                        </select>
                                                    </label>
                                                    <label className="field">
                                                        <span>Key Path</span>
                                                        <input
                                                            type="text"
                                                            value={step.keyPath}
                                                            placeholder="theme.colors.primary"
                                                            onChange={e => updateStep(step.id, { keyPath: e.target.value })}
                                                        />
                                                        <span className="hint">Escape dots for literal keys (example: workbench\\.colorTheme).</span>
                                                    </label>
                                                    <label className="field">
                                                        <span>Value Type</span>
                                                        <select
                                                            value={step.valueType}
                                                            onChange={e => updateStep(step.id, { valueType: e.target.value as SetJsonValueStep['valueType'] })}
                                                        >
                                                            <option value="string">String</option>
                                                            <option value="number">Number</option>
                                                            <option value="boolean">Boolean</option>
                                                            <option value="json">JSON</option>
                                                        </select>
                                                    </label>
                                                </div>

                                                {step.valueType === 'boolean' ? (
                                                    <label className="toggle">
                                                        <input
                                                            type="checkbox"
                                                            checked={step.valueBool}
                                                            onChange={e => updateStep(step.id, { valueBool: e.target.checked })}
                                                        />
                                                        Value is true
                                                    </label>
                                                ) : step.valueType === 'json' ? (
                                                    <label className="field">
                                                        <span>JSON Value</span>
                                                        <textarea
                                                            value={step.valueRaw}
                                                            placeholder='{"enabled": true}'
                                                            onChange={e => updateStep(step.id, { valueRaw: e.target.value })}
                                                        />
                                                        <button
                                                            className="btn-ghost"
                                                            type="button"
                                                            onClick={() => formatJsonValue(step.id)}
                                                        >
                                                            Format JSON
                                                        </button>
                                                    </label>
                                                ) : (
                                                    <label className="field">
                                                        <span>Value</span>
                                                        <input
                                                            type="text"
                                                            value={step.valueRaw}
                                                            placeholder="Value"
                                                            onChange={e => updateStep(step.id, { valueRaw: e.target.value })}
                                                        />
                                                    </label>
                                                )}
                                            </div>
                                        )}

                                        {step.type === 'base64Embed' && (
                                            <div className="step-body">
                                                <div className="step-grid">
                                                    <label className="field">
                                                        <span>Target File</span>
                                                        <input
                                                            type="text"
                                                            value={step.file}
                                                            placeholder="styles/app.css"
                                                            onChange={e => updateStep(step.id, { file: e.target.value })}
                                                        />
                                                        <select
                                                            className="path-helper"
                                                            onChange={e => updateStep(step.id, { file: e.target.value })}
                                                        >
                                                            <option value="">Path helper...</option>
                                                            {COMMON_TARGETS.map(option => (
                                                                <option key={`embed-file-${option.value}`} value={option.value}>
                                                                    {option.label}
                                                                </option>
                                                            ))}
                                                        </select>
                                                    </label>
                                                    <label className="field">
                                                        <span>Placeholder</span>
                                                        <input
                                                            type="text"
                                                            value={step.placeholder}
                                                            placeholder="{{LOGO_BASE64}}"
                                                            onChange={e => updateStep(step.id, { placeholder: e.target.value })}
                                                        />
                                                    </label>
                                                </div>

                                                <label className="field">
                                                    <span>Input File (Payload)</span>
                                                    <div className="file-row">
                                                        <input
                                                            type="text"
                                                            value={step.inputSource}
                                                            placeholder="C:\\path\\to\\logo.png"
                                                            onChange={e => updateStep(step.id, { inputSource: e.target.value })}
                                                        />
                                                        <button
                                                            className="btn-ghost"
                                                            type="button"
                                                            onClick={() => pickPath(step.id, 'inputSource', 'inputRel', false)}
                                                        >
                                                            Pick File
                                                        </button>
                                                    </div>
                                                </label>
                                                <label className="field">
                                                    <span>Payload Path (inside payloads/)</span>
                                                    <input
                                                        type="text"
                                                        value={step.inputRel}
                                                        placeholder="assets/logo.png"
                                                        onChange={e => updateStep(step.id, { inputRel: e.target.value })}
                                                    />
                                                </label>
                                            </div>
                                        )}

                                        {step.type === 'runCommand' && (
                                            <div className="step-body">
                                                <div className="step-grid">
                                                    <label className="field">
                                                        <span>Command</span>
                                                        <input
                                                            type="text"
                                                            value={step.command}
                                                            placeholder="cmd"
                                                            onChange={e => updateStep(step.id, { command: e.target.value })}
                                                        />
                                                    </label>
                                                    <label className="field">
                                                        <span>Args (comma separated)</span>
                                                        <input
                                                            type="text"
                                                            value={step.args}
                                                            placeholder="/c, echo Hello"
                                                            onChange={e => updateStep(step.id, { args: e.target.value })}
                                                        />
                                                    </label>
                                                </div>
                                            </div>
                                        )}
                                        {issues.length > 0 && (
                                            <div className="step-issues">
                                                {issues.map((issue, idx) => (
                                                    <div key={`${step.id}-issue-${idx}`} className={`issue ${issue.level}`}>
                                                        {issue.message}
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    <div className="actions">
                        <button className="btn-primary" onClick={handleBuild} disabled={building}>
                            {building ? 'Forging...' : 'Forge Installer'}
                        </button>
                    </div>

                    <div className="log-title">Forge log</div>
                    <div className="log-panel" style={{ height: '170px' }}>
                        {logs.map((log, i) => <div key={i} className="log-line">{log}</div>)}
                        <div ref={logEndRef} />
                    </div>
                </section>
            </div>
        </div>
    );
}
