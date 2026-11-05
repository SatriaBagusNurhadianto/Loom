import { render } from 'solid-js/web';
import { Workspace } from './workspace/Workspace';
import './ui/tokens.css';
import './workspace/workspace.css';
import './appearance/appearance.css';

render(() => <Workspace />, document.getElementById('root')!);
