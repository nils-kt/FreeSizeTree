import { webDarkTheme, webLightTheme, type Theme } from '@fluentui/react-components';
import { useEffect, useState } from 'react';

// Fluent 2 with the accent colors and type ramp of Windows 11 (WinUI): light blue with dark
// text in dark mode, deep blue with white text in light mode.
const font = {
  fontFamilyBase: '"Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif',
  fontFamilyMonospace: '"Cascadia Mono", Consolas, monospace',
};

function accent(fill: string, hover: string, pressed: string, onAccent: string, text: string): Partial<Theme> {
  return {
    colorBrandBackground: fill,
    colorBrandBackgroundHover: hover,
    colorBrandBackgroundPressed: pressed,
    colorBrandBackgroundSelected: fill,
    colorCompoundBrandBackground: fill,
    colorCompoundBrandBackgroundHover: hover,
    colorCompoundBrandBackgroundPressed: pressed,
    colorCompoundBrandStroke: fill,
    colorCompoundBrandStrokeHover: hover,
    colorCompoundBrandStrokePressed: pressed,
    colorCompoundBrandForeground1: fill,
    colorCompoundBrandForeground1Hover: hover,
    colorCompoundBrandForeground1Pressed: pressed,
    colorBrandStroke1: fill,
    colorBrandForeground1: text,
    colorBrandForeground2: text,
    colorBrandForegroundLink: text,
    colorBrandForegroundLinkHover: text,
    colorNeutralForegroundOnBrand: onAccent,
    colorStrokeFocus2: onAccent === '#000000' ? '#ffffff' : '#000000',
  };
}

export const darkTheme: Theme = {
  ...webDarkTheme,
  ...font,
  ...accent('#60cdff', '#5ab9e6', '#52a5cc', '#000000', '#99ebff'),
  colorNeutralBackground1: '#2b2b2b',
  colorNeutralBackground1Hover: '#323232',
  colorNeutralBackground1Pressed: '#272727',
};

export const lightTheme: Theme = {
  ...webLightTheme,
  ...font,
  ...accent('#005fb8', '#1a6fc0', '#3380c8', '#ffffff', '#003e92'),
};

export function useDarkMode(): boolean {
  const query = '(prefers-color-scheme: dark)';
  const [dark, setDark] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const mq = matchMedia(query);
    const fn = () => setDark(mq.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);
  return dark;
}

// Category colors used in charts and legends.
const HUES = [207, 262, 168, 28, 330, 48, 190, 292, 120, 0, 228, 80];
export const hueAt = (i: number) => HUES[i % HUES.length];
export const topColor = (i: number, dark: boolean) => `hsl(${hueAt(i)} ${dark ? 62 : 58}% ${dark ? 62 : 50}%)`;

export const TYPE_GROUPS = [
  { c: '#c239b3', label: 'Video', ext: ['.mp4', '.mkv', '.mov', '.avi', '.webm', '.wmv', '.m4v'] },
  { c: '#13a10e', label: 'Bild', ext: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.psd', '.raw', '.cr2', '.nef', '.heic', '.tif', '.tiff', '.bmp', '.exr'] },
  { c: '#ca5010', label: 'Audio', ext: ['.mp3', '.wav', '.flac', '.ogg', '.m4a', '.aac', '.bnk', '.wem'] },
  { c: '#986f0b', label: 'Archiv', ext: ['.zip', '.7z', '.rar', '.tar', '.gz', '.xz', '.cab'] },
  { c: '#0078d4', label: 'Disk', ext: ['.iso', '.img', '.vhd', '.vhdx', '.vmdk', '.qcow2', '.dmp'] },
  { c: '#8764b8', label: 'Programm', ext: ['.exe', '.msi', '.dll', '.sys', '.msix', '.appx'] },
  { c: '#e3008c', label: 'KI-Modell', ext: ['.gguf', '.safetensors', '.ckpt', '.pt', '.pth', '.onnx', '.bin'] },
  { c: '#d13438', label: 'Spieldaten', ext: ['.pak', '.rpf', '.uasset', '.ubulk', '.forge', '.vpk', '.big', '.wad', '.ucas', '.utoc', '.arc'] },
  { c: '#038387', label: 'Dokument', ext: ['.pdf', '.docx', '.xlsx', '.pptx', '.txt', '.md', '.csv', '.db', '.sqlite', '.vscdb', '.sqlite3'] },
];
export const typeColor = (ext?: string) => TYPE_GROUPS.find(g => ext && g.ext.includes(ext))?.c ?? '#8a8886';

export const LAUNCHER_COLORS: Record<string, string> = {
  Steam: '#1b78c2', Epic: '#6e6e6e', EA: '#e3343a', Rockstar: '#d39a0a', Xbox: '#107c10', GOG: '#8a3fc4',
  Ubisoft: '#2a6ad1', 'Battle.net': '#148eff', Riot: '#d13639', Amazon: '#e88b00',
};
