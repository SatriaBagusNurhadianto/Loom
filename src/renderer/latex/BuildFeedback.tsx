import { Show } from 'solid-js';
import type { PdfIssue } from './presentation';
export function BuildFeedback(props: {
  issue: PdfIssue;
  busy: boolean;
  retained: boolean;
  onAction: () => void;
  onDetails?: () => void;
}) {
  return (
    <section class="pdf-feedback" aria-label="PDF guidance" role="status">
      <h3>{props.issue.title}</h3>
      <p>{props.issue.detail}</p>
      <Show when={props.retained}>
        <p class="muted">Your last successful PDF is still available below.</p>
      </Show>
      <div class="button-row">
        <button class="secondary-button" disabled={props.busy} onClick={props.onAction}>
          {
            {
              main: 'Choose main document',
              folder: 'Open paper folder',
              setup: 'Set up PDF tools',
              source: props.issue.location ? 'Go to problem' : 'Open paper files',
              retry: 'Try again',
            }[props.issue.action]
          }
        </button>
        <Show when={props.onDetails}>
          <button class="text-button" onClick={props.onDetails}>
            View details
          </button>
        </Show>
      </div>
    </section>
  );
}
