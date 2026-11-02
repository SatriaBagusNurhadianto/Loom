import {
  projectCommandSchema,
  projectResultSchema,
  type ProjectChoice,
  type ProjectCommand,
} from '../contracts/project';
import { contextBridge, ipcRenderer } from 'electron';
import {
  channels,
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
