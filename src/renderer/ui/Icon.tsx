import { For } from 'solid-js';
const paths = {
  back: ['M20 12H4m6-6-6 6 6 6'],
  list: ['M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01'],
  appearance: [
    'M12 3a9 9 0 1 0 9 9c0-1.5-1-2-2.5-2H17a2 2 0 0 1-2-2V6.5C15 4 14 3 12 3z',
    'M7 10h.01M9 6h.01M6 15h.01M11 18h.01',
  ],
  sun: [
    'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8',
    'M12 2v2M12 20v2M2 12h2M20 12h2m-3-9-1.5 1.5m-11 11L4 20m0-16 1.5 1.5m13 13L20 20',
  ],
  moon: ['M20 14A8 8 0 0 1 10 4a8.5 8.5 0 1 0 10 10z'],
  monitor: ['M3 3h18v14H3z', 'M12 17v4M8 21h8'],
  gitBranch: [
    'M6 3v12',
    'M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
    'M21 6a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
    'M18 9a9 9 0 0 1-9 9',
  ],
  gitCommit: ['M3 12h5m8 0h5', 'M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0'],
  fetch: ['M4 4h16v16H4z', 'M12 7v10m-4-4 4 4 4-4'],
  pull: ['M12 3v12m-4-4 4 4 4-4', 'M4 17v4h16v-4'],
  push: ['M12 17V5m-4 4 4-4 4 4', 'M4 17v4h16v-4'],
  clone: ['M8 8h13v13H8z', 'M16 8V3H3v13h5', 'M12 14h5m-2-2 2 2-2 2'],
  build: ['m13 2-9 12h7l-1 8 10-12h-7z'],
  stop: ['M6 6h12v12H6z'],
  science: ['M9 3h6M10 3v7l-6 9a1 1 0 0 0 1 2h14a1 1 0 0 0 1-2l-6-9V3', 'M8 15h8'],
  copy: ['M9 9h12v12H9z', 'M15 9V3H3v12h6'],
  brain: [
    'M12 18V5a3 3 0 0 0-5.8-1A4 4 0 0 0 4 11a4 4 0 0 0 1 7 4 4 0 0 0 7 2 4 4 0 0 0 7-2 4 4 0 0 0 1-7 4 4 0 0 0-2.2-7A3 3 0 0 0 12 5',
    'M8 8c-2 0-3 1-3 3M16 8c2 0 3 1 3 3M8 16c0 2 2 3 4 2M16 16c0 2-2 3-4 2',
  ],
  lock: ['M5 11h14v10H5z', 'M8 11V7a4 4 0 0 1 8 0v4', 'M12 15v2'],
  unlock: ['M5 11h14v10H5z', 'M8 11V7a4 4 0 0 1 7.5-2', 'M12 15v2'],
  plug: ['M8 3v5M16 3v5M6 8h12v3a6 6 0 0 1-12 0V8z', 'M12 17v4'],
  disconnect: ['M8 3v5M16 3v5M6 8h12v3a6 6 0 0 1-6 6M12 17v4', 'm3 3 18 18'],
  cpu: ['M6 6h12v12H6zM9 9h6v6H9z', 'M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3'],
  terminal: ['M3 4h18v16H3z', 'm7 9 3 3-3 3M13 15h4'],
  bookOpen: ['M12 5v16M3 3h5a4 4 0 0 1 4 2 4 4 0 0 1 4-2h5v16h-5a4 4 0 0 0-4 2 4 4 0 0 0-4-2H3V3z'],
  user: ['M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0', 'M4 21v-2a8 8 0 0 1 16 0v2'],
  shieldCheck: ['M12 3 3 7v5c0 5 9 9 9 9s9-4 9-9V7l-9-4z', 'm8 12 3 3 5-6'],
  more: ['M5 12h.01M12 12h.01M19 12h.01'],
  save: ['M4 3h14l3 3v15H3V3z', 'M7 3v6h10V3M7 21v-8h10v8'],
  panel: ['M4 4h16v16H4z', 'M9 4v16'],
  preview: ['M4 4h16v16H4z', 'M15 4v16'],
  chevron: ['m8 5 7 7-7 7'],
  down: ['m5 9 7 7 7-7'],
  plus: ['M12 5v14', 'M5 12h14'],
  search: ['M21 21l-5-5', 'M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0'],
  file: ['M6 3h9l4 4v14H6z', 'M9 10h7M9 14h5'],
  folder: ['M3 7V5h6l2 2h10v13H3z', 'M3 10h18'],
  close: ['m6 6 12 12', 'M18 6 6 18'],
  expand: ['M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5'],
  download: ['M12 3v12m-5-5 5 5 5-5', 'M4 16v5h16v-5'],
  arrow: ['M12 20V4', 'm5 11 7-7 7 7'],
  chat: ['M21 11a9 9 0 0 1-9 9H4l-2 2v-10a9 9 0 1 1 19-1'],
  tools: ['M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z'],
  settings: [
    'M10 2h4l.5 3 2 1.2 2.8-1 2 3.5-2.3 2v2.6l2.3 2-2 3.5-2.8-1-2 1.2-.5 3h-4l-.5-3-2-1.2-2.8 1-2-3.5 2.3-2v-2.6l-2.3-2 2-3.5 2.8 1 2-1.2z',
    'M15.5 12a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0',
  ],
  refresh: ['M20 7v5h-5', 'M20 12a8 8 0 1 0-2 6'],
  info: ['M12 11v6M12 7v.1', 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0'],
  check: ['m5 12 4 4L20 5'],
  fileText: [
    'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z',
    'M14 2v6h6',
    'M16 13H8',
    'M16 17H8',
    'M10 9H8',
  ],
  fileBib: [
    'M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z',
    'M6 6h10',
    'M6 10h10',
  ],
  fileCode: ['m16 18 6-6-6-6', 'M8 6l-6 6 6 6'],
  fileImage: [
    'M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7',
    'm21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21',
    'M9 9h.01',
  ],
  star: [
    'm12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z',
  ],
  edit: ['M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z', 'm15 5 4 4'],
  trash: ['M3 6h18', 'M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6', 'M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2'],
  restore: ['M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8', 'M3 3v5h5'],
  warning: [
    'm21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z',
    'M12 9v4',
    'M12 17h.01',
  ],
  section: ['M4 6h16', 'M4 12h10', 'M4 18h14'],
} satisfies Record<string, string[]>;
export type IconName = keyof typeof paths;
export function Icon(props: { name: IconName; size?: number }) {
  return (
    <svg
      width={props.size ?? 18}
      height={props.size ?? 18}
      data-icon={props.name}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <For each={paths[props.name]}>{(d) => <path d={d} />}</For>
    </svg>
  );
}
