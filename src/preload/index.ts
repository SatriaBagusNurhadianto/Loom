import { researchCommandSchema, researchResultSchema } from '../contracts/research';
import { agentCommandSchema, agentResultSchema } from '../contracts/agent';
import { latexCommandSchema, latexResultSchema, exportPdfSchema } from '../contracts/latex';
import {
  projectCommandSchema,
  chooseFileRequestSchema,
  projectResultSchema,
  type ProjectChoice,
  type ProjectCommand,
} from '../contracts/project';
import { contextBridge, ipcRenderer } from 'electron';
import { gitCommandSchema, gitResultSchema } from '../contracts/git';
import {
  channels,
  attachmentChoiceSchema,
  attachmentResultSchema,
  failure,
  serviceEventSchema,
  statusResultSchema,
  type LoomDesktop,
  type Result,
  type ServiceStatus,
} from '../contracts/desktop';

async function invoke(
  channel: typeof channels.status | typeof channels.restart,
): Promise<Result<ServiceStatus>> {
  try {
    const result = statusResultSchema.safeParse(await ipcRenderer.invoke(channel, {}));
    return result.success
      ? result.data
      : failure('INVALID_RESPONSE', 'The desktop service returned an invalid response.');
  } catch {
    return failure(
      'SERVICE_UNAVAILABLE',
      'The desktop connection is unavailable. Reopen Loom to reconnect.',
    );
  }
}

const desktop: LoomDesktop = {
  research: async (command) => {
    const input = researchCommandSchema.safeParse(command);
    if (!input.success) return failure('INVALID_REQUEST', 'Invalid reference request.', false);
    try {
      return researchResultSchema.parse(await ipcRenderer.invoke(channels.research, input.data));
    } catch {
      return failure(
        'SERVICE_UNAVAILABLE',
        'Reference connection interrupted. Inspect citation recovery before retrying.',
      );
    }
  },
  openSource: async (url) => {
    await ipcRenderer.invoke(channels.openSource, url);
  },
  agent: async (command) => {
    const input = agentCommandSchema.safeParse(command);
    if (!input.success) return failure('INVALID_REQUEST', 'Invalid agent command.', false);
    try {
      return agentResultSchema.parse(await ipcRenderer.invoke(channels.agent, input.data));
    } catch {
      return failure(
        'SERVICE_UNAVAILABLE',
        'Agent connection interrupted. Reconnect before continuing.',
      );
    }
  },
  openSetup: async (guide) => {
    if (guide === 'tex' || guide === 'texlab' || guide === 'opencode' || guide === 'codex')
      await ipcRenderer.invoke(channels.setup, guide);
  },
  latex: async (command) => {
    const input = latexCommandSchema.safeParse(command);
    if (!input.success) return failure('INVALID_REQUEST', 'Invalid LaTeX command.', false);
    try {
      return latexResultSchema.parse(await ipcRenderer.invoke(channels.latex, input.data));
    } catch {
      return failure(
        'SERVICE_UNAVAILABLE',
        'LaTeX connection interrupted. Reconnect and compile again.',
      );
    }
  },
  git: async (command) => {
    const input = gitCommandSchema.safeParse(command);
    if (!input.success) return failure('INVALID_REQUEST', 'Invalid Git request.', false);
    try {
      return gitResultSchema.parse(await ipcRenderer.invoke(channels.git, input.data));
    } catch {
      return failure(
        'SERVICE_UNAVAILABLE',
        'Git connection interrupted. Refresh repository status before retrying.',
      );
    }
  },
  exportPdf: async (request) => {
    const input = exportPdfSchema.safeParse(request);
    if (!input.success) return failure('INVALID_REQUEST', 'Invalid PDF export.', false);
    try {
      return latexResultSchema.parse(await ipcRenderer.invoke(channels.exportPdf, input.data));
    } catch {
      return failure('SERVICE_UNAVAILABLE', 'PDF export failed. Retry.');
    }
  },
  chooseAttachments: async (request) => {
    const input = attachmentChoiceSchema.safeParse(request);
    if (!input.success) return failure('INVALID_REQUEST', 'Invalid attachment choice.', false);
    try {
      return attachmentResultSchema.parse(
        await ipcRenderer.invoke(channels.chooseAttachments, input.data),
      );
    } catch {
      return failure('SERVICE_UNAVAILABLE', 'The file selector is unavailable. Try again.');
    }
  },
  chooseFile: async (request) => {
    const input = chooseFileRequestSchema.safeParse(request);
    if (!input.success) return failure('INVALID_REQUEST', 'Invalid file choice.', false);
    try {
      return projectResultSchema.parse(await ipcRenderer.invoke(channels.chooseFile, input.data));
    } catch {
      return failure('SERVICE_UNAVAILABLE', 'The file dialog is unavailable. Try again.');
    }
  },
  project: async (command: ProjectCommand) => {
    const input = projectCommandSchema.safeParse(command);
    if (!input.success) return failure('INVALID_REQUEST', 'Invalid project command.', false);
    try {
      return projectResultSchema.parse(await ipcRenderer.invoke(channels.project, input.data));
    } catch {
      return failure('SERVICE_UNAVAILABLE', 'Project connection failed. Restart to recover.');
    }
  },
  chooseProject: async (choice: ProjectChoice) => {
    try {
      return projectResultSchema.parse(await ipcRenderer.invoke(channels.chooseProject, choice));
    } catch {
      return failure('SERVICE_UNAVAILABLE', 'Project dialog failed. Retry.');
    }
  },
  onCloseRequest: (listener) => {
    const handler = () => listener();
    ipcRenderer.on(channels.closeRequest, handler);
    return () => ipcRenderer.removeListener(channels.closeRequest, handler);
  },
  completeClose: async () => {
    await ipcRenderer.invoke(channels.closeReady, {});
  },
  getStatus: () => invoke(channels.status),
  restartService: () => invoke(channels.restart),
  onServiceEvent: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
      const event = serviceEventSchema.safeParse(payload);
      if (event.success) listener(event.data);
    };
    ipcRenderer.on(channels.event, handler);
    return () => ipcRenderer.removeListener(channels.event, handler);
  },
};
contextBridge.exposeInMainWorld('loom', desktop);
