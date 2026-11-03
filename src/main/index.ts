import { latexCommandSchema, exportPdfSchema } from '../contracts/latex';
import { writePdfExport } from './pdf-export';
import { z } from 'zod';
import { chooseFileRequestSchema, projectCommandSchema } from '../contracts/project';
import {
  app,
  shell,
  dialog,
  BrowserWindow,
  ipcMain,
  session,
  utilityProcess,
  type IpcMainInvokeEvent,
} from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  channels,
  emptyRequestSchema,
  failure,
  type Result,
  type ServiceStatus,
} from '../contracts/desktop';
import { ServiceController } from './service-controller';

let window: BrowserWindow | undefined;
let closeAllowed = false;
let crashRecoveries = 0;
const service = new ServiceController(() => {
  const child = utilityProcess.fork(join(__dirname, 'service.cjs'), [app.getPath('userData')], {
    serviceName: 'Loom local services',
  });
  return {
    postMessage: (message) => child.postMessage(message),
    onMessage: (listener) => {
      child.on('message', listener);
    },
    onExit: (listener) => {
      child.once('exit', listener);
    },
    onError: (listener) => {
      child.once('error', listener);
    },
    kill: () => {
      child.kill();
    },
  };
});

const rendererFile = join(__dirname, '../renderer/index.html');
const rendererUrl = process.env.ELECTRON_RENDERER_URL || pathToFileURL(rendererFile).href;

function trustedSender(event: IpcMainInvokeEvent): boolean {
  if (
    !window ||
    window.isDestroyed() ||
    event.sender !== window.webContents ||
    event.senderFrame !== window.webContents.mainFrame
  )
    return false;
  try {
    const sender = new URL(event.senderFrame.url);
    const expected = new URL(rendererUrl);
    return (
      sender.protocol === expected.protocol &&
      sender.host === expected.host &&
      sender.pathname === expected.pathname
    );
  } catch {
    return false;
  }
}

function handle(channel: string, action: () => Promise<Result<ServiceStatus>>): void {
  ipcMain.handle(channel, (event, payload: unknown) => {
    if (!trustedSender(event))
      return failure('FORBIDDEN', 'This window cannot access desktop services.', false);
    if (!emptyRequestSchema.safeParse(payload).success)
      return failure('INVALID_REQUEST', 'The desktop request is invalid.', false);
    return action();
  });
}

function createWindow(bounds?: { width: number; height: number }): void {
  window = new BrowserWindow({
    title: 'Loom',
    width: bounds?.width ?? 1440,
    height: bounds?.height ?? 960,
    minWidth: 720,
    minHeight: 540,
    backgroundColor: '#171717',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  const current = window;
  closeAllowed = false;
  current.on('close', (event) => {
    if (!closeAllowed && !current.webContents.isCrashed()) {
      event.preventDefault();
      current.webContents.send(channels.closeRequest, {});
    }
  });
  current.webContents.on('render-process-gone', () => {
    if (current.isDestroyed() || crashRecoveries++ >= 2) return;
    const bounds = current.getBounds();
    createWindow(bounds);
    current.destroy();
  });
  current.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  current.webContents.on('will-navigate', (event) => {
    event.preventDefault();
  });
  current.webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });
  current.once('ready-to-show', () => {
    current.show();
  });
  current.once('closed', () => {
    if (window === current) window = undefined;
  });
  if (process.env.ELECTRON_RENDERER_URL) void current.loadURL(rendererUrl);
  else void current.loadFile(rendererFile);
}

void app.whenReady().then(() => {
  app.setName('Loom');
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false);
  });
  session.defaultSession.setPermissionCheckHandler(() => false);
  ipcMain.handle(channels.closeReady, (event, payload: unknown) => {
    if (!trustedSender(event) || !emptyRequestSchema.safeParse(payload).success) return;
    closeAllowed = true;
    window?.close();
  });
  handle(channels.status, () => service.getStatus());
  handle(channels.restart, () => service.restart());
  service.subscribe((event) => {
    if (window && !window.isDestroyed()) window.webContents.send(channels.event, event);
  });
  ipcMain.handle(channels.project, (event, payload: unknown) => {
    if (!trustedSender(event))
      return failure('FORBIDDEN', 'This window cannot access projects.', false);
    const command = projectCommandSchema.safeParse(payload);
    if (!command.success) return failure('INVALID_REQUEST', 'Invalid project command.', false);
    return service.project(command.data);
  });
  ipcMain.handle(channels.setup, async (event, guide: unknown) => {
    if (!trustedSender(event)) return;
    if (guide === 'tex') await shell.openExternal('https://www.latex-project.org/get/');
    else if (guide === 'texlab')
      await shell.openExternal('https://github.com/latex-lsp/texlab#installation');
  });
  ipcMain.handle(channels.latex, (event, payload: unknown) => {
    if (!trustedSender(event))
      return failure('FORBIDDEN', 'This window cannot use LaTeX services.', false);
    const command = latexCommandSchema.safeParse(payload);
    if (!command.success) return failure('INVALID_REQUEST', 'Invalid LaTeX command.', false);
    return service.latex(command.data);
  });
  ipcMain.handle(channels.exportPdf, async (event, payload: unknown) => {
    if (!trustedSender(event))
      return failure('FORBIDDEN', 'This window cannot export PDFs.', false);
    const input = exportPdfSchema.safeParse(payload);
    if (!input.success) return failure('INVALID_REQUEST', 'Invalid PDF export.', false);
    if (choosing) return failure('BUSY', 'A native dialog is already open.');
    choosing = true;
    try {
      const pdf = await service.latex({
        type: 'pdf',
        projectId: input.data.projectId,
        buildId: input.data.buildId,
      });
      if (!pdf.ok || pdf.value.kind !== 'pdf') return pdf;
      const current = await service.project({ type: 'refresh' });
      const location = service.projectLocation;
      if (!current.ok) return current;
      if (
        !current.value ||
        current.value.id !== input.data.projectId ||
        location?.projectId !== input.data.projectId
      )
        return failure('INVALID_REQUEST', 'The project changed. Retry PDF export.', false);
      const older = input.data.stale || pdf.value.revision !== current.value.sourceRevision;
      const selected = await dialog.showSaveDialog(window!, {
        title: older ? 'Export older PDF — source has changed' : 'Export compiled PDF',
        defaultPath: older ? 'paper-older-build.pdf' : 'paper.pdf',
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      });
      if (selected.canceled || !selected.filePath)
        return { ok: true, value: { kind: 'export', cancelled: true } };
      const latest = await service.project({ type: 'refresh' });
      if (!latest.ok) return latest;
      if (
        latest.value?.id !== current.value.id ||
        latest.value.sourceRevision !== current.value.sourceRevision
      )
        return failure(
          'INVALID_REQUEST',
          'Source changed while choosing the destination. Retry export to identify the older PDF.',
          true,
        );
      await writePdfExport(selected.filePath, Buffer.from(pdf.value.data, 'base64'), {
        root: location.path,
        paths: latest.value.files.filter((f) => !f.deleted).map((f) => f.path),
      });
      return { ok: true, value: { kind: 'export', cancelled: false } };
    } catch (error) {
      return failure(
        'INVALID_REQUEST',
        error instanceof Error
          ? error.message
          : 'PDF could not be exported. Check the destination and retry.',
      );
    } finally {
      choosing = false;
    }
  });
  let choosing = false;
  ipcMain.handle(channels.chooseFile, async (event, payload: unknown) => {
    if (!trustedSender(event))
      return failure('FORBIDDEN', 'This window cannot create project files.', false);
    const input = chooseFileRequestSchema.safeParse(payload);
    if (!input.success) return failure('INVALID_REQUEST', 'Invalid file choice.', false);
    if (choosing) return failure('BUSY', 'A file dialog is already open.');
    choosing = true;
    try {
      const current = await service.project({ type: 'current' });
      if (!current.ok) return current;
      const location = service.projectLocation;
      if (
        !location ||
        current.value?.id !== input.data.projectId ||
        location.projectId !== input.data.projectId
      )
        return failure('INVALID_REQUEST', 'Open the project before creating a file.', false);
      const selected = await dialog.showSaveDialog(window!, {
        title: 'Create new file',
        buttonLabel: 'Create file',
        defaultPath: join(location.path, input.data.directory ?? '', 'untitled.tex'),
      });
      if (selected.canceled || !selected.filePath) return { ok: true, value: null };
      return service.project({
        type: 'native-create-file',
        path: selected.filePath,
        projectId: input.data.projectId,
      });
    } catch {
      return failure('SERVICE_UNAVAILABLE', 'The file dialog could not open. Try again.');
    } finally {
      choosing = false;
    }
  });
  ipcMain.handle(channels.chooseProject, async (event, payload: unknown) => {
    if (!trustedSender(event))
      return failure('FORBIDDEN', 'This window cannot choose projects.', false);
    const choice = z.enum(['open', 'create', 'import-folder', 'import-zip']).safeParse(payload);
    if (!choice.success) return failure('INVALID_REQUEST', 'Invalid project choice.', false);
    if (choosing) return failure('BUSY', 'A project dialog is already open.');
    choosing = true;
    try {
      if (choice.data === 'create') {
        const selected = await dialog.showSaveDialog(window!, {
          title: 'Create project folder',
          buttonLabel: 'Create project',
        });
        if (selected.canceled || !selected.filePath) return { ok: true, value: null };
        return service.project({ type: 'native-create', path: selected.filePath });
      }
      const selected = await dialog.showOpenDialog(window!, {
        title: choice.data === 'import-zip' ? 'Import project ZIP' : 'Choose project folder',
        properties: choice.data === 'import-zip' ? ['openFile'] : ['openDirectory'],
        ...(choice.data === 'import-zip'
          ? { filters: [{ name: 'ZIP archive', extensions: ['zip'] }] }
          : {}),
      });
      if (selected.canceled) return { ok: true, value: null };
      if (choice.data === 'open')
        return service.project({ type: 'native-open', path: selected.filePaths[0] });
      const target = await dialog.showSaveDialog(window!, {
        title: 'New imported project folder',
        buttonLabel: 'Import project',
      });
      if (target.canceled || !target.filePath) return { ok: true, value: null };
      return service.project({
        type: `native-${choice.data}`,
        path: selected.filePaths[0],
        destination: target.filePath,
      });
    } finally {
      choosing = false;
    }
  });
  void service.start();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', () => {
  service.stop();
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
