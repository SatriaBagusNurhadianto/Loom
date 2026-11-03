import { For } from 'solid-js';
const paths = {
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
    'M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z',
    'M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
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
