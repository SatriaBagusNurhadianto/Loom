import {
  app,
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
const service = new ServiceController(() => {
  const child = utilityProcess.fork(join(__dirname, 'service.cjs'), [], {
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

function createWindow(): void {
  window = new BrowserWindow({
    title: 'Loom',
    width: 1440,
    height: 960,
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
  handle(channels.status, () => service.getStatus());
  handle(channels.restart, () => service.restart());
  service.subscribe((event) => {
    if (window && !window.isDestroyed()) window.webContents.send(channels.event, event);
  });
  void service.start();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  service.stop();
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
