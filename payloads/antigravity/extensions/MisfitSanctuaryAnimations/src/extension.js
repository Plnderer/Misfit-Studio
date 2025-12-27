const vscode = require('vscode');

let glowInterval;

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
    const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 1000);
    statusItem.text = '$(flame) Shinobi';
    statusItem.tooltip = 'Click to open the MisfitSanctuary portal';
    statusItem.command = 'misfitsanctuary.showPanel';
    statusItem.show();
    context.subscriptions.push(statusItem);

    const colors = ['#7DFB39', '#A0FF60', '#F6A526', '#FFBE4C'];
    let index = 0;

    glowInterval = setInterval(() => {
        index = (index + 1) % colors.length;
        statusItem.color = colors[index];
    }, 650);

    context.subscriptions.push({
        dispose() {
            clearInterval(glowInterval);
        }
    });

    const showPanelCommand = vscode.commands.registerCommand('misfitsanctuary.showPanel', () => {
        const panel = vscode.window.createWebviewPanel(
            'misfitsanctuaryPanel',
            'MisfitSanctuary Portal',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );
        panel.webview.html = getWebviewContent();
    });

    context.subscriptions.push(showPanelCommand);
}
exports.activate = activate;

function deactivate() {
    if (glowInterval) {
        clearInterval(glowInterval);
    }
}
exports.deactivate = deactivate;

function getWebviewContent() {
    const accent = '#7DFB39';
    const accentSoft = '#A0FF60';
    const ember = '#F6A526';
    const emberSoft = '#FFBE4C';
    const background = '#050505';
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<style>
    :root {
        color-scheme: dark;
        --accent: ${accent};
        --accent-soft: ${accentSoft};
        --ember: ${ember};
        --ember-soft: ${emberSoft};
        --bg: ${background};
    }
    body {
        margin: 0;
        overflow: hidden;
        background:
            radial-gradient(circle at 20% 15%, rgba(125, 251, 57, 0.15), transparent 40%),
            radial-gradient(circle at 80% 70%, rgba(246, 165, 38, 0.18), transparent 45%),
            linear-gradient(180deg, #050505 0%, #0b0b0b 100%);
        color: #f7f7f7;
        font-family: 'Segoe UI', sans-serif;
    }
    body::before {
        content: '';
        position: fixed;
        inset: 0;
        background: repeating-linear-gradient(
            to bottom,
            rgba(255, 255, 255, 0.03),
            rgba(255, 255, 255, 0.03) 2px,
            rgba(0, 0, 0, 0.02) 2px,
            rgba(0, 0, 0, 0.02) 4px
        );
        opacity: 0.35;
        pointer-events: none;
        animation: scanline 10s linear infinite;
    }
    body::after {
        content: '';
        position: fixed;
        inset: 0;
        background: radial-gradient(circle at 50% 30%, rgba(125, 251, 57, 0.2), transparent 55%),
                    radial-gradient(circle at 50% 75%, rgba(246, 165, 38, 0.18), transparent 60%);
        opacity: 0.65;
        pointer-events: none;
        animation: auraShift 8s ease-in-out infinite;
    }
    canvas {
        display: block;
        width: 100vw;
        height: 100vh;
        filter: drop-shadow(0 0 25px rgba(125, 251, 57, 0.25))
                drop-shadow(0 0 70px rgba(246, 165, 38, 0.18));
        animation: canvasGlow 6s ease-in-out infinite;
    }
    #loading {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        color: var(--accent);
        text-shadow: 0 0 10px rgba(125, 251, 57, 0.6), 0 0 25px rgba(246, 165, 38, 0.35);
        letter-spacing: 0.2rem;
        text-transform: uppercase;
        font-weight: 600;
        pointer-events: none;
        animation: pulse 2s infinite;
    }
    @keyframes pulse {
        0% { opacity: 0.2; }
        50% { opacity: 1; }
        100% { opacity: 0.2; }
    }
    @keyframes scanline {
        0% { transform: translateY(0); }
        100% { transform: translateY(6px); }
    }
    @keyframes auraShift {
        0% { opacity: 0.4; filter: blur(0px); }
        50% { opacity: 0.75; filter: blur(1px); }
        100% { opacity: 0.4; filter: blur(0px); }
    }
    @keyframes canvasGlow {
        0% { filter: drop-shadow(0 0 25px rgba(125, 251, 57, 0.2)) drop-shadow(0 0 60px rgba(246, 165, 38, 0.15)); }
        50% { filter: drop-shadow(0 0 35px rgba(125, 251, 57, 0.35)) drop-shadow(0 0 80px rgba(246, 165, 38, 0.25)); }
        100% { filter: drop-shadow(0 0 25px rgba(125, 251, 57, 0.2)) drop-shadow(0 0 60px rgba(246, 165, 38, 0.15)); }
    }
</style>
</head>
<body>
    <div id="loading">Generating Misfit Earth...</div>
    <script type="importmap">
        {
            "imports": {
                "three": "https://unpkg.com/three@0.160.0/build/three.module.js",
                "three/addons/": "https://unpkg.com/three@0.160.0/examples/jsm/"
            }
        }
    </script>
    <script type="module">
        import * as THREE from 'three';
        import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
        import GUI from 'https://cdn.jsdelivr.net/npm/lil-gui@0.19/+esm';

        const glslNoise = \`
            vec4 permute(vec4 x){return mod(((x*34.0)+1.0)*x, 289.0);}
            vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314 * r;}
            float snoise(vec3 v){ 
                const vec2  C = vec2(1.0/6.0, 1.0/3.0) ;
                const vec4  D = vec4(0.0, 0.5, 1.0, 2.0);
                vec3 i  = floor(v + dot(v, C.yyy) );
                vec3 x0 =   v - i + dot(i, C.xxx) ;
                vec3 g = step(x0.yzx, x0.xyz);
                vec3 l = 1.0 - g;
                vec3 i1 = min( g.xyz, l.zxy );
                vec3 i2 = max( g.xyz, l.zxy );
                vec3 x1 = x0 - i1 + 1.0 * C.xxx;
                vec3 x2 = x0 - i2 + 2.0 * C.xxx;
                vec3 x3 = x0 - 1.0 + 3.0 * C.xxx;
                i = mod(i, 289.0 ); 
                vec4 p = permute( permute( permute( 
                            i.z + vec4(0.0, i1.z, i2.z, 1.0 ))
                          + i.y + vec4(0.0, i1.y, i2.y, 1.0 )) 
                          + i.x + vec4(0.0, i1.x, i2.x, 1.0 ));
                float n_ = 1.0/7.0;
                vec3  ns = n_ * D.wyz - D.xzx;
                vec4 j = p - 49.0 * floor(p * ns.z *ns.z);
                vec4 x_ = floor(j * ns.z);
                vec4 y_ = floor(j - 7.0 * x_ );
                vec4 x = x_ *ns.x + ns.yyyy;
                vec4 y = y_ *ns.x + ns.yyyy;
                vec4 h = 1.0 - abs(x) - abs(y);
                vec4 b0 = vec4( x.xy, y.xy );
                vec4 b1 = vec4( x.zw, y.zw );
                vec4 s0 = floor(b0)*2.0 + 1.0;
                vec4 s1 = floor(b1)*2.0 + 1.0;
                vec4 sh = -step(h, vec4(0.0));
                vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy ;
                vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww ;
                vec3 p0 = vec3(a0.xy,h.x);
                vec3 p1 = vec3(a0.zw,h.y);
                vec3 p2 = vec3(a1.xy,h.z);
                vec3 p3 = vec3(a1.zw,h.w);
                vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
                p0 *= norm.x;
                p1 *= norm.y;
                p2 *= norm.z;
                p3 *= norm.w;
                vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
                m = m * m;
                return 42.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1), 
                                              dot(p2,x2), dot(p3,x3) ) );
            }
            float fbm(vec3 p, int octaves, float persistence, float lacunarity) {
                float amplitude = 1.0;
                float frequency = 1.0;
                float total = 0.0;
                float normalization = 0.0;
                for (int i = 0; i < octaves; ++i) {
                    total += amplitude * snoise(p * frequency);
                    normalization += amplitude;
                    amplitude *= persistence;
                    frequency *= lacunarity;
                }
                return total / normalization;
            }
        \`;

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
        camera.position.z = 3.5;
        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.setClearColor(0x000000, 0);
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        document.body.appendChild(renderer.domElement);

        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.05;
        controls.minDistance = 1.5;
        controls.maxDistance = 20;

        const sunDirection = new THREE.Vector3(1.0, 0.5, 1.0).normalize();

        const params = {
            rotationSpeed: 0.05,
            seaLevel: 0.52,
            continentSize: 1.5,
            mountainHeight: 1.2,
            roughness: 0.55,
            detail: 6.0,
            iceCapThreshold: 0.9,
            colorDeepWater: "#04160f",
            colorShallowWater: "#0c3f2a",
            colorBeach: "#5a3e1c",
            colorGrass: "#3f7c2f",
            colorForest: "#1c3a1c",
            colorMountain: "#4d4d4d",
            colorSnow: "#f7f7f7",
            atmosphereDensity: 0.35,
            atmosphereColor: "${accent}"
        };

        const brandAccent = new THREE.Color("${accent}");
        const brandEmber = new THREE.Color("${ember}");
        const brandTint = new THREE.Color();
        const atmosphereBase = new THREE.Color(params.atmosphereColor);

        const uniforms = {
            uTime: { value: 0 },
            uSunDirection: { value: sunDirection },
            uSeaLevel: { value: params.seaLevel },
            uContinentSize: { value: params.continentSize },
            uMountainHeight: { value: params.mountainHeight },
            uRoughness: { value: params.roughness },
            uDetail: { value: params.detail },
            uIceCapThreshold: { value: params.iceCapThreshold },
            uColorDeepWater: { value: new THREE.Color(params.colorDeepWater) },
            uColorShallowWater: { value: new THREE.Color(params.colorShallowWater) },
            uColorBeach: { value: new THREE.Color(params.colorBeach) },
            uColorGrass: { value: new THREE.Color(params.colorGrass) },
            uColorForest: { value: new THREE.Color(params.colorForest) },
            uColorMountain: { value: new THREE.Color(params.colorMountain) },
            uColorSnow: { value: new THREE.Color(params.colorSnow) },
        };

        const terrainVertexShader = glslNoise + \`
            uniform float uContinentSize;
            uniform float uMountainHeight;
            uniform float uRoughness;
            uniform float uDetail;
            uniform float uSeaLevel;
            varying vec3 vNormal;
            varying vec3 vPosition;
            varying float vHeight;
            varying float vLatitude;
            void main() {
                vNormal = normalize(normalMatrix * normal);
                vec3 pos = position;
                float h = fbm(pos * uContinentSize, 8, uRoughness, uDetail);
                float hm = fbm(pos * uContinentSize * 4.0, 4, uRoughness, uDetail * 1.5);
                hm = 1.0 - abs(hm);
                hm = pow(hm, 3.0);
                float finalHeight = (h * 0.6 + hm * 0.4) + 0.5;
                vHeight = finalHeight;
                vLatitude = abs(normalize(pos).y);
                float displacement = 0.0;
                if (finalHeight > uSeaLevel) {
                    displacement = (finalHeight - uSeaLevel) * uMountainHeight * 0.1;
                }
                vec3 displacedPosition = pos + normal * displacement;
                vPosition = (modelMatrix * vec4(displacedPosition, 1.0)).xyz;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(displacedPosition, 1.0);
            }
        \`;

        const terrainFragmentShader = \`
            uniform vec3 uSunDirection;
            uniform float uSeaLevel;
            uniform float uIceCapThreshold;
            uniform vec3 uColorDeepWater;
            uniform vec3 uColorShallowWater;
            uniform vec3 uColorBeach;
            uniform vec3 uColorGrass;
            uniform vec3 uColorForest;
            uniform vec3 uColorMountain;
            uniform vec3 uColorSnow;
            varying vec3 vNormal;
            varying vec3 vPosition;
            varying float vHeight;
            varying float vLatitude;
            void main() {
                vec3 normal = normalize(vNormal);
                vec3 lightDir = normalize(uSunDirection);
                vec3 viewDir = normalize(cameraPosition - vPosition);
                float NdotL = max(dot(normal, lightDir), 0.0);
                vec3 ambient = vec3(0.08);
                float specularStrength = 0.0;
                if (vHeight <= uSeaLevel) {
                    vec3 reflectDir = reflect(-lightDir, normal);
                    float spec = pow(max(dot(viewDir, reflectDir), 0.0), 32.0);
                    specularStrength = spec * 0.5;
                }
                vec3 color;
                float h = vHeight;
                if (h <= uSeaLevel) {
                    float waterDepth = smoothstep(uSeaLevel - 0.2, uSeaLevel, h);
                    color = mix(uColorDeepWater, uColorShallowWater, waterDepth);
                } else {
                    float alt = smoothstep(uSeaLevel, 1.0, h);
                    color = mix(uColorBeach, uColorGrass, smoothstep(0.0, 0.05, alt));
                    color = mix(color, uColorForest, smoothstep(0.05, 0.3, alt));
                    color = mix(color, uColorMountain, smoothstep(0.3, 0.7, alt));
                    color = mix(color, uColorSnow, smoothstep(0.7, 0.9, alt));
                }
                float ice = smoothstep(uIceCapThreshold - 0.1, uIceCapThreshold, vLatitude);
                if (vHeight <= uSeaLevel) {
                    color = mix(color, uColorSnow * 0.9, ice);
                    if (ice > 0.5) specularStrength *= 0.1;
                } else {
                    color = mix(color, uColorSnow, ice);
                }
                float night = 1.0 - NdotL;
                night = smoothstep(0.5, 0.8, night);
                if (night > 0.0 && h > uSeaLevel && h < uSeaLevel + 0.3 && vLatitude < uIceCapThreshold - 0.1) {
                    float cityNoise = fract(sin(dot(vPosition.xy ,vec2(12.9898,78.233))) * 43758.5453);
                    if (cityNoise > 0.98) {
                        color += vec3(1.0, 0.8, 0.4) * night * 1.5;
                    }
                }
                vec3 finalColor = (ambient + NdotL) * color + vec3(specularStrength);
                finalColor = mix(finalColor, color * 0.2, smoothstep(0.6, 1.0, night));
                gl_FragColor = vec4(finalColor, 1.0);
            }
        \`;

        const atmosphereVertexShader = \`
            varying vec3 vNormal;
            varying vec3 vViewDir;
            void main() {
                vNormal = normalize(normalMatrix * normal);
                vec4 worldPosition = modelMatrix * vec4(position, 1.0);
                vViewDir = normalize(cameraPosition - worldPosition.xyz);
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        \`;

        const atmosphereFragmentShader = \`
            uniform vec3 uSunDirection;
            uniform vec3 uAtmosphereColor;
            uniform float uAtmosphereDensity;
            varying vec3 vNormal;
            varying vec3 vViewDir;
            void main() {
                float viewDotNormal = dot(vViewDir, vNormal);
                float intensity = pow(0.6 - viewDotNormal, 2.5);
                float lightIntensity = max(dot(vNormal, uSunDirection), 0.0);
                vec3 atmosphere = uAtmosphereColor * intensity * uAtmosphereDensity;
                atmosphere *= (0.3 + 0.7 * smoothstep(-0.5, 1.0, lightIntensity));
                gl_FragColor = vec4(atmosphere, atmosphere.r + atmosphere.g + atmosphere.b);
            }
        \`;

        const geometry = new THREE.IcosahedronGeometry(1, 96);
        const material = new THREE.ShaderMaterial({
            vertexShader: terrainVertexShader,
            fragmentShader: terrainFragmentShader,
            uniforms: uniforms
        });
        const planet = new THREE.Mesh(geometry, material);
        scene.add(planet);

        const atmoGeometry = new THREE.IcosahedronGeometry(1.15, 24);
        const atmoMaterial = new THREE.ShaderMaterial({
            vertexShader: atmosphereVertexShader,
            fragmentShader: atmosphereFragmentShader,
            uniforms: {
                uSunDirection: { value: sunDirection },
                uAtmosphereColor: { value: atmosphereBase.clone() },
                uAtmosphereDensity: { value: params.atmosphereDensity }
            },
            side: THREE.BackSide,
            blending: THREE.AdditiveBlending,
            transparent: true,
            depthWrite: false
        });
        const atmosphere = new THREE.Mesh(atmoGeometry, atmoMaterial);
        scene.add(atmosphere);

        const cloudTextureCanvas = document.createElement('canvas');
        cloudTextureCanvas.width = 768;
        cloudTextureCanvas.height = 384;
        const ctx = cloudTextureCanvas.getContext('2d');
        ctx.fillStyle = 'black';
        ctx.fillRect(0,0,cloudTextureCanvas.width,cloudTextureCanvas.height);
        ctx.filter = 'blur(30px)';
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        for(let i=0; i<80; i++) {
            ctx.beginPath();
            ctx.arc(Math.random()*cloudTextureCanvas.width, Math.random()*cloudTextureCanvas.height, Math.random()*40 + 15, 0, Math.PI*2);
            ctx.fill();
        }
        ctx.filter = 'none';
        const cloudTexture = new THREE.CanvasTexture(cloudTextureCanvas);
        cloudTexture.wrapS = THREE.RepeatWrapping;
        cloudTexture.wrapT = THREE.ClampToEdgeWrapping;
        const cloudMaterial = new THREE.MeshStandardMaterial({
            map: cloudTexture,
            transparent: true,
            opacity: 0.35,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
            depthWrite: false
        });
        cloudMaterial.color = new THREE.Color("#dfffe2");
        const cloudMesh = new THREE.Mesh(new THREE.SphereGeometry(1.03, 48, 48), cloudMaterial);
        scene.add(cloudMesh);

        const starGeometry = new THREE.BufferGeometry();
        const starMaterial = new THREE.PointsMaterial({color: 0xdfffe2, size: 0.02});
        const starVertices = [];
        const starCount = 1800;
        for(let i=0; i<starCount; i++) {
            const x = (Math.random() - 0.5) * 200;
            const y = (Math.random() - 0.5) * 200;
            const z = (Math.random() - 0.5) * 200;
            if(Math.abs(x) + Math.abs(y) + Math.abs(z) > 50) {
                starVertices.push(x,y,z);
            }
        }
        starGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starVertices, 3));
        const stars = new THREE.Points(starGeometry, starMaterial);
        scene.add(stars);

        const galaxyGeometry = new THREE.BufferGeometry();
        const galaxyCount = 1400;
        const galaxyPositions = new Float32Array(galaxyCount * 3);
        const galaxyColors = new Float32Array(galaxyCount * 3);
        const innerColor = new THREE.Color('#0b140c');
        const outerColor = new THREE.Color('${ember}');
        for (let i = 0; i < galaxyCount; i++) {
            const radius = THREE.MathUtils.randFloat(20, 45);
            const branch = (i % 4) / 4 * Math.PI * 2;
            const spin = radius * 0.035;
            const random = (Math.random() - 0.5) * 0.5;
            const angle = branch + spin + random;
            const x = Math.cos(angle) * radius;
            const y = (Math.random() - 0.5) * 8;
            const z = Math.sin(angle) * radius;
            galaxyPositions[i * 3] = x;
            galaxyPositions[i * 3 + 1] = y;
            galaxyPositions[i * 3 + 2] = z;
            const color = innerColor.clone().lerp(outerColor, (radius - 20) / 25);
            galaxyColors[i * 3] = color.r;
            galaxyColors[i * 3 + 1] = color.g;
            galaxyColors[i * 3 + 2] = color.b;
        }
        galaxyGeometry.setAttribute('position', new THREE.BufferAttribute(galaxyPositions, 3));
        galaxyGeometry.setAttribute('color', new THREE.BufferAttribute(galaxyColors, 3));
        const galaxyMaterial = new THREE.PointsMaterial({ size: 0.18, vertexColors: true, transparent: true, opacity: 0.22, depthWrite: false });
        const galaxy = new THREE.Points(galaxyGeometry, galaxyMaterial);
        scene.add(galaxy);

        const gui = new GUI({ width: 260, title: 'Misfit Planet Controls' });
        const folderTerrain = gui.addFolder('Terrain Generation');
        const throttles = {};
        function throttledUpdate(key, fn) {
            if (throttles[key]) {
                clearTimeout(throttles[key]);
            }
            throttles[key] = setTimeout(fn, 100);
        }

        folderTerrain.add(params, 'seaLevel', 0.0, 1.0).name('Sea Level').onChange(v => throttledUpdate('seaLevel', () => uniforms.uSeaLevel.value = v));
        folderTerrain.add(params, 'continentSize', 0.1, 5.0).name('Continent Freq').onChange(v => throttledUpdate('continentSize', () => uniforms.uContinentSize.value = v));
        folderTerrain.add(params, 'mountainHeight', 0.0, 3.0).name('Mtn Height').onChange(v => throttledUpdate('mountainHeight', () => uniforms.uMountainHeight.value = v));
        folderTerrain.add(params, 'roughness', 0.1, 0.9).name('Roughness').onChange(v => throttledUpdate('roughness', () => uniforms.uRoughness.value = v));
        folderTerrain.add(params, 'iceCapThreshold', 0.0, 1.0).name('Ice Caps').onChange(v => throttledUpdate('iceCap', () => uniforms.uIceCapThreshold.value = v));
        const folderColors = gui.addFolder('Colors');
        folderColors.addColor(params, 'colorDeepWater').name('Deep Water').onChange(v => throttledUpdate('deepWater', () => uniforms.uColorDeepWater.value.set(v)));
        folderColors.addColor(params, 'colorShallowWater').name('Shallow Water').onChange(v => throttledUpdate('shallowWater', () => uniforms.uColorShallowWater.value.set(v)));
        folderColors.addColor(params, 'colorBeach').name('Beach').onChange(v => throttledUpdate('beach', () => uniforms.uColorBeach.value.set(v)));
        folderColors.addColor(params, 'colorGrass').name('Grass').onChange(v => throttledUpdate('grass', () => uniforms.uColorGrass.value.set(v)));
        folderColors.addColor(params, 'colorForest').name('Forest').onChange(v => throttledUpdate('forest', () => uniforms.uColorForest.value.set(v)));
        folderColors.addColor(params, 'colorMountain').name('Mountain').onChange(v => throttledUpdate('mountain', () => uniforms.uColorMountain.value.set(v)));
        folderColors.close();
        const folderAtmo = gui.addFolder('Atmosphere & Misc');
        folderAtmo.add(params, 'atmosphereDensity', 0.0, 1.0).name('Atmo Density').onChange(v => throttledUpdate('atmoDensity', () => atmoMaterial.uniforms.uAtmosphereDensity.value = v));
        folderAtmo.addColor(params, 'atmosphereColor').name('Atmo Color').onChange(v => throttledUpdate('atmoColor', () => {
            atmosphereBase.set(v);
            atmoMaterial.uniforms.uAtmosphereColor.value.set(v);
        }));
        folderAtmo.add(params, 'rotationSpeed', 0.0, 0.5).name('Rotation Speed');

        const clock = new THREE.Clock();
        function animate() {
            requestAnimationFrame(animate);
            const delta = clock.getDelta();
            const t = clock.elapsedTime;
            const glow = (Math.sin(t * 0.35) + 1) / 2;
            uniforms.uTime.value = clock.elapsedTime;
            planet.rotation.y += params.rotationSpeed * delta;
            cloudMesh.rotation.y += params.rotationSpeed * delta * 1.2;
            atmosphere.rotation.y += params.rotationSpeed * delta * 0.1;
            stars.rotation.y -= delta * 0.005;
            galaxy.rotation.y += delta * 0.002;
            brandTint.copy(brandAccent).lerp(brandEmber, glow);
            galaxyMaterial.color.copy(brandTint);
            galaxyMaterial.opacity = 0.2 + 0.05 * Math.sin(t * 0.4);
            cloudMaterial.opacity = 0.32 + 0.05 * Math.sin(t * 0.6);
            atmoMaterial.uniforms.uAtmosphereColor.value.copy(atmosphereBase).lerp(brandTint, 0.25 * glow);
            controls.update();
            renderer.render(scene, camera);
        }
        const loadingEl = document.getElementById('loading');
        if (loadingEl) {
            loadingEl.style.opacity = 0;
            setTimeout(() => loadingEl.remove(), 800);
        }
        window.addEventListener('resize', () => {
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);
        });
        animate();
    </script>
</body>
</html>`;
}
