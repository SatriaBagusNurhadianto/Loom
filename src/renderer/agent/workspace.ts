import { createEffect, createMemo, createSignal, onCleanup, onMount, untrack } from 'solid-js';
import {
  defaultAgentSettings,
  type AgentSettings,
  type AgentCommand,
  type AgentModel,
  type AgentState,
  type HarnessKind,
} from '../../contracts/agent';
import type { ProjectWorkspace } from '../editor/documents';
import { imageMime } from '../../domain/images';
export function createAgentWorkspace(projects: ProjectWorkspace, report: (text: string) => void) {
  const [state, setState] = createSignal<AgentState | null>(null),
    [error, setError] = createSignal(''),
    [busy, setBusy] = createSignal(false),
    [draft, setDraftValue] = createSignal(''),
    [modelKey, setModelKeyValue] = createSignal(''),
    [open, setOpen] = createSignal(false),
    [attachments, setAttachments] = createSignal<string[]>([]),
    [imagePreview, setImagePreview] = createSignal<{
      path: string;
      url: string;
      submitted: boolean;
    } | null>(null),
    [selection, setSelection] = createSignal<{ path: string; text: string } | null>(null),
    [submitting, setSubmitting] = createSignal(false);
  let generation = 0,
    disposed = false,
    polling = false,
    sequence = 0,
    accepted = 0,
    cancelAfterSend = false,
    imageSequence = 0;
  const [runtimePaths, setRuntimePaths] = createSignal<Record<string, string>>({});
  function runtimePath(kind: HarnessKind) {
    const draft = runtimePaths()[kind];
    if (draft !== undefined) return draft;
    try {
      return window.localStorage.getItem('loom:agent-runtime:v1:' + kind) ?? '';
    } catch {
      return '';
    }
  }
  function setRuntimePath(kind: HarnessKind, value: string) {
    setRuntimePaths((old) => ({ ...old, [kind]: value }));
    try {
      window.localStorage.setItem('loom:agent-runtime:v1:' + kind, value);
    } catch {
      /* The path remains usable for this window. */
    }
  }
  const settings = () => state()?.settings ?? defaultAgentSettings();
  async function setSettings(value: AgentSettings) {
    const projectId = projects.project()?.id;
    if (projectId) return !!(await act({ type: 'settings', projectId, settings: value }));
    return false;
  }
  const key = () => `loom:agent-draft:${projects.project()?.id ?? 'none'}`;
  function setDraft(text: string) {
    setDraftValue(text);
    try {
      window.localStorage.setItem(key(), text);
    } catch {
      setError(
        'The request draft could not be stored locally. Keep this window open until you send or copy it.',
      );
    }
  }
  async function setModelKey(value: string) {
    setModelKeyValue(value);
    const chosen = state()?.models.find((m) => `${m.providerId}:${m.id}` === value);
    const clearReasoning =
      settings().reasoning && !(chosen?.reasoningEfforts ?? []).includes(settings().reasoning);
    try {
      window.localStorage.setItem(
        `loom:agent-model:${projects.project()?.id}:${state()?.harness}`,
        value,
      );
    } catch {
      /* Selection still works for this session. */
    }
    if (clearReasoning) await setSettings({ ...settings(), reasoning: '' });
  }
  const harnessIdentity = createMemo(() =>
    state()?.connection === 'connected' ? `${state()?.projectId}:${state()?.harness}` : '',
  );
  createEffect(() => {
    const identity = harnessIdentity();
    if (identity) {
      try {
        setModelKeyValue(window.localStorage.getItem('loom:agent-model:' + identity) ?? '');
      } catch {
        setModelKeyValue('');
      }
    }
  });
  const model = createMemo(
    () =>
      state()?.models.find((m) => `${m.providerId}:${m.id}` === modelKey()) ?? state()?.models[0],
  );
  async function request(command: AgentCommand, quiet = false) {
    if (!window.loom) {
      if (!quiet) setError('Agent connections require the Loom desktop application.');
      return;
    }
    const current = generation,
      requestId = ++sequence;
    const result = await window.loom.agent(command);
    if (disposed || current !== generation || projects.project()?.id !== command.projectId) return;
    if (!result.ok) {
      if (!quiet) setError(result.error.message);
      return;
    }
    if (requestId >= accepted) {
      accepted = requestId;
      setState((previous) => {
        const value = result.value;
        if (!previous) return value;
        const stable = <T extends { id: string }>(old: T[], next: T[]) =>
          next.map((item) => {
            const existing = old.find((v) => v.id === item.id);
            return existing && JSON.stringify(existing) === JSON.stringify(item) ? existing : item;
          });
        return {
          ...value,
          models: stable(previous.models, value.models),
          providers: stable(previous.providers, value.providers),
          sessions: stable(previous.sessions, value.sessions),
          messages: stable(previous.messages, value.messages),
          permissions: stable(previous.permissions, value.permissions),
          questions: stable(previous.questions, value.questions),
          turns: stable(previous.turns, value.turns),
        };
      });
    }
    if (!quiet) setError('');
    return result.value;
  }
  async function refresh(detect = false) {
    const projectId = projects.project()?.id;
    if (!projectId || polling || busy()) return;
    polling = true;
    try {
      await request({ type: 'status', projectId, detect }, !detect);
    } finally {
      polling = false;
    }
  }
  const identity = createMemo(() => projects.project()?.id);
  createEffect(() => {
    const id = identity();
    untrack(() => {
      ++generation;
      accepted = ++sequence;
      setState(null);
      setError('');
      setAttachments([]);
      setImagePreview(null);
      ++imageSequence;
      setSelection(null);
      setOpen(false);
      setBusy(false);
      setSubmitting(false);
      setModelKey('');
      try {
        setDraftValue((window.localStorage.getItem(key()) ?? '').slice(0, 50000));
      } catch {
        setDraftValue('');
      }
      if (id) void refresh();
    });
  });
  async function act(command: AgentCommand) {
    if (busy()) return;
    const current = generation;
    setBusy(true);
    try {
      return await request(command);
    } finally {
      if (current === generation) setBusy(false);
    }
  }
  async function connect(
    harness: HarnessKind,
    endpoint?: string,
    username?: string,
    password?: string,
    executable?: string,
  ) {
    const projectId = projects.project()?.id;
    if (!projectId) {
      setError('Open a paper folder before connecting an agent.');
      return false;
    }
    return !!(await act({
      type: 'connect',
      projectId,
      harness,
      endpoint,
      username,
      password,
      executable: executable ?? runtimePath(harness),
    }));
  }
  async function newChat() {
    const projectId = projects.project()?.id;
    if (!projectId) return false;
    const result = await act({ type: 'session', projectId });
    if (result) {
      setOpen(true);
      closeImage();
    }
    return !!result;
  }
  async function selectChat(sessionId: string) {
    const projectId = projects.project()?.id;
    if (!projectId) return;
    const ref = state()?.sessions.find((s) => s.id === sessionId);
    if (ref && (ref.harness !== state()?.harness || state()?.connection !== 'connected')) {
      if (!(await connect(ref.harness))) return false;
    }
    const result = await act({ type: 'session', projectId, sessionId });
    if (result) {
      setOpen(true);
      closeImage();
      return true;
    }
    return false;
  }
  async function send() {
    const projectId = projects.project()?.id,
      prompt = draft().trim(),
      chosen = model();
    if (
      !projectId ||
      !prompt ||
      !chosen ||
      busy() ||
      state()?.running ||
      state()?.sessionUnavailable
    )
      return;
    if (attachments().some((path) => imageMime(path)) && !chosen.images) {
      return;
    }
    const current = generation;
    setBusy(true);
    setSubmitting(true);
    cancelAfterSend = false;
    setOpen(true);
    try {
      if (!(await projects.flushPending())) {
        setError('Save your paper before sending. Your request is kept here.');
        return;
      }
      await projects.command({ type: 'refresh' });
      if (current !== generation || projects.project()?.id !== projectId) return;
      if (
        projects
          .project()
          ?.files.some((f) => !f.deleted && (f.conflict || projects.live(f.id)?.dirty))
      ) {
        setError(
          'Your writing changed while preparing the request. Finish the current edit or review the conflict, then send again.',
        );
        return;
      }
      let sessionId = state()?.sessionId;
      if (!sessionId) {
        const created = await request({ type: 'session', projectId });
        sessionId = created?.sessionId;
      }
      if (!sessionId || cancelAfterSend) return;
      const sent = await request({
        type: 'send',
        projectId,
        sessionId,
        prompt,
        model: chosen,
        attachments: attachments(),
        selection: selection(),
        revision: projects.project()!.sourceRevision!,
      });
      if (sent) {
        if (draft().trim() === prompt) setDraft('');
        setAttachments([]);
        setSelection(null);
      }
      if (cancelAfterSend && sent) await request({ type: 'cancel', projectId });
    } finally {
      if (current === generation) {
        setBusy(false);
        setSubmitting(false);
        void refresh();
      }
    }
  }
  async function cancel() {
    if (submitting()) {
      cancelAfterSend = true;
      report('Stopping the request as soon as the agent accepts it.');
      return;
    }
    const projectId = projects.project()?.id;
    if (projectId) await act({ type: 'cancel', projectId });
  }
  async function attachFiles() {
    const projectId = projects.project()?.id;
    if (!projectId || !window.loom || busy()) return;
    const limit = 20 - attachments().length;
    if (!limit) {
      setError('Attach up to 20 files per request.');
      return;
    }
    const current = generation;
    setBusy(true);
    try {
      const result = await window.loom.chooseAttachments({ projectId, limit });
      if (current !== generation || projects.project()?.id !== projectId) return;
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      if (!result.value.cancelled) {
        if (result.value.imported) await projects.command({ type: 'refresh' });
        if (current !== generation || projects.project()?.id !== projectId) return;
        const paths = [...new Set([...attachments(), ...result.value.paths])];
        if (paths.length > 20) {
          setError('Attach up to 20 files per request.');
          return;
        }
        setAttachments(paths);
        setError('');
        if (result.value.imported)
          report(
            `${result.value.imported} image${result.value.imported === 1 ? '' : 's'} copied into this paper.`,
          );
      }
    } finally {
      if (current === generation) setBusy(false);
    }
  }
  async function showImage(path: string) {
    const projectId = projects.project()?.id;
    const current = generation;
    const requestId = ++imageSequence;
    if (!projectId || !window.loom) return;
    const result = await window.loom.project({ type: 'preview-image', projectId, path });
    if (
      current !== generation ||
      requestId !== imageSequence ||
      projects.project()?.id !== projectId
    )
      return;
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    const preview = result.value?.imagePreview;
    if (preview) {
      setImagePreview({
        path: preview.path,
        url: `data:${preview.mime};base64,${preview.data}`,
        submitted: false,
      });
      setError('');
    }
  }
  async function showSubmittedImage(turnId: string, path: string) {
    const projectId = projects.project()?.id,
      sessionId = state()?.sessionId,
      current = generation,
      requestId = ++imageSequence;
    if (!projectId || !sessionId || !window.loom) return;
    const result = await window.loom.agent({
      type: 'preview-submitted-image',
      projectId,
      turnId,
      path,
    });
    if (
      current !== generation ||
      requestId !== imageSequence ||
      projects.project()?.id !== projectId ||
      state()?.sessionId !== sessionId
    )
      return;
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    const preview = result.value.imagePreview;
    if (preview) {
      setImagePreview({
        path: preview.path,
        url: `data:${preview.mime};base64,${preview.data}`,
        submitted: true,
      });
      setError('');
    }
  }
  function closeImage() {
    ++imageSequence;
    setImagePreview(null);
  }
  async function pasteImage(file: File) {
    const projectId = projects.project()?.id;
    if (!projectId || busy() || state()?.running) {
      setError(
        !projectId
          ? 'Open a paper before pasting an image.'
          : 'Wait for the current operation to finish before pasting an image.',
      );
      return;
    }
    const current = generation;
    if (attachments().length >= 20) {
      setError('Attach up to 20 files per request.');
      return;
    }
    const extension = (
      {
        'image/png': 'png',
        'image/jpeg': 'jpg',
        'image/gif': 'gif',
        'image/webp': 'webp',
      } as Record<string, string>
    )[file.type];
    if (!extension || file.size > 10 * 1024 * 1024) {
      setError('Paste a PNG, JPEG, GIF or WebP image of at most 10 MiB.');
      return;
    }
    setBusy(true);
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('Could not read the pasted image.'));
        reader.onload = () =>
          typeof reader.result === 'string'
            ? resolve(reader.result.split(',')[1] ?? '')
            : reject(new Error('Could not read the pasted image.'));
        reader.readAsDataURL(file);
      });
      if (current !== generation || projects.project()?.id !== projectId) return;
      const path = `loom-paste-${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}.${extension}`;
      const result = await projects.command({ type: 'import-image', projectId, path, data });
      if (current !== generation || projects.project()?.id !== projectId) return;
      if (result?.ok) {
        if (attachments().length >= 20) {
          setError(`Image saved as ${path}, but the attachment limit was reached.`);
          return;
        }
        setAttachments((old) => [...old, path]);
        setError('');
        report(`Pasted image saved as ${path}`);
      } else if (result && !result.ok)
        setError(`${result.error.message} Check whether ${path} was saved before retrying.`);
    } catch (error) {
      if (current === generation)
        setError(error instanceof Error ? error.message : 'Could not paste the image.');
    } finally {
      if (current === generation) setBusy(false);
    }
  }
  function attachSelection() {
    const file = projects.file(),
      caret = file ? projects.caret(file.id) : undefined;
    const text = file ? projects.live(file.id)?.doc.getText('source').toString() : undefined;
    if (!file || !caret || text === undefined || caret.anchor === caret.head) {
      setError('Select a passage in the source editor, then choose Attach selected text.');
      return false;
    }
    const value = text.slice(
      Math.min(caret.anchor, caret.head),
      Math.max(caret.anchor, caret.head),
    );
    if (value.length > 50000) {
      setError('Select a shorter passage (up to 50,000 characters).');
      return false;
    }
    setSelection({ path: file.path, text: value });
    setError('');
    return true;
  }
  async function review(turnId: string, path: string, action: 'keep' | 'revert') {
    const projectId = projects.project()?.id;
    if (!projectId || busy()) return;
    setBusy(true);
    try {
      if (!(await projects.flushPending())) return;
      await projects.command({ type: 'refresh' });
      if (projects.project()?.id !== projectId) return;
      const result = await request({
        type: 'review',
        projectId,
        turnId,
        path,
        action,
        revision: projects.project()!.sourceRevision!,
      });
      if (result) {
        await projects.command({ type: 'refresh' });
        report(
          action === 'keep'
            ? 'Change kept.'
            : 'Change reverted; compatible newer writing is retained.',
        );
        return true;
      }
      return false;
    } finally {
      setBusy(false);
    }
  }
  onMount(() => {
    const timer = setInterval(() => {
      if (state()?.connection === 'connected' || state()?.running) void refresh();
    }, 750);
    const unsub = window.loom?.onServiceEvent((event) => {
      if (event.status.state === 'ready') void refresh();
      else if (event.status.state === 'unavailable') {
        ++generation;
        accepted = ++sequence;
        polling = false;
        setBusy(false);
        setSubmitting(false);
        setState((previous) =>
          previous
            ? { ...previous, connection: 'interrupted', permissions: [], questions: [] }
            : null,
        );
        if (state()?.sessionId || state()?.running)
          setError(
            'The local service was interrupted. Reconnect the agent to recover this conversation and its changes.',
          );
      }
    });
    onCleanup(() => {
      clearInterval(timer);
      unsub?.();
    });
  });
  onCleanup(() => {
    disposed = true;
    ++generation;
  });
  return {
    state,
    settings,
    setSettings,
    runtimePath,
    setRuntimePath,
    error,
    setError,
    busy,
    draft,
    setDraft,
    model,
    modelKey,
    setModelKey,
    open,
    setOpen,
    attachments,
    imagePreview,
    closeImage,
    showSubmittedImage,
    showImage,
    pasteImage,
    setAttachments,
    selection,
    setSelection,
    submitting,
    request,
    refresh,
    connect,
    newChat,
    selectChat,
    send,
    cancel,
    attachSelection,
    attachFiles,
    review,
    act,
    projects,
  };
}
export type AgentWorkspace = ReturnType<typeof createAgentWorkspace>;
export const modelIdentity = (model: AgentModel) => `${model.providerId}:${model.id}`;
