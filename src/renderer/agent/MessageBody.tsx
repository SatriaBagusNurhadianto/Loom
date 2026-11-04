import { For } from 'solid-js';
import './message.css';
import { messageBlocks } from './message-blocks';
function Inline(props: { text: string }) {
  const parts = () =>
    props.text.split(/(`+[^`\n]+`+|\*\*[^*\n]+\*\*|__[^_\n]+__|\[[^\]\n]+\]\([^\n)]+\))/g);
  return (
    <For each={parts()}>
      {(part) =>
        part.startsWith('`') ? (
          <code>{part.replace(/^`+|`+$/g, '')}</code>
        ) : part.startsWith('**') || part.startsWith('__') ? (
          <strong>{part.slice(2, -2)}</strong>
        ) : /^\[.*\]\(.*\)$/.test(part) ? (
          <span class="agent-message-reference" title={part.slice(part.indexOf('](') + 2, -1)}>
            {part.slice(1, part.indexOf(']('))}
          </span>
        ) : (
          part
        )
      }
    </For>
  );
}
export function MessageBody(props: { text: string }) {
  return (
    <div class="agent-markdown">
      <For each={messageBlocks(props.text)}>
        {(block) => {
          if (block.kind === 'code')
            return (
              <div class="agent-code-block">
                <div>{block.language || 'Code'}</div>
                <pre>
                  <code>{block.text}</code>
                </pre>
              </div>
            );
          if (block.kind === 'heading')
            return (
              <h4>
                <Inline text={block.text} />
              </h4>
            );
          if (block.kind === 'quote')
            return (
              <blockquote>
                <Inline text={block.text} />
              </blockquote>
            );
          if (block.kind === 'list')
            return block.ordered ? (
              <ol>
                <For each={block.text.split('\n')}>
                  {(line) => (
                    <li>
                      <Inline text={line} />
                    </li>
                  )}
                </For>
              </ol>
            ) : (
              <ul>
                <For each={block.text.split('\n')}>
                  {(line) => (
                    <li>
                      <Inline text={line} />
                    </li>
                  )}
                </For>
              </ul>
            );
          return (
            <p>
              <Inline text={block.text} />
            </p>
          );
        }}
      </For>
    </div>
  );
}
