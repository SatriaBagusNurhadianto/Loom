import { For } from 'solid-js';
const paths = {
  panel: ['M4 4h16v16H4z', 'M9 4v16'],
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
