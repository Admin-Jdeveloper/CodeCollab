import * as Y from "yjs";
import { MonacoBinding } from "y-monaco";
import type { editor } from "monaco-editor";
import type { Socket } from "socket.io-client";

/**
 * Normalizes various binary representations into a standard Uint8Array.
 * Handles Uint8Array, ArrayBuffer, Node.js Buffer JSON representation, or number array.
 */
export function normalizeBinary(data: any): Uint8Array {
  if (!data) return new Uint8Array(0);
  if (data instanceof Uint8Array && data.byteOffset === 0 && data.byteLength === data.buffer.byteLength) {
    return data;
  }
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
  }
  if (data instanceof ArrayBuffer) return new Uint8Array(data.slice(0));
  if (Array.isArray(data)) return new Uint8Array(data);
  if (data?.type === "Buffer" && Array.isArray(data?.data)) {
    return new Uint8Array(data.data);
  }
  return new Uint8Array(data);
}

/**
 * Custom Socket.IO provider for synchronizing a single Yjs document.
 * Adheres to the canonical Yjs sync protocol (Step 1, Step 2, Incremental updates)
 * with robust reconnection handling, echo-suppression, and clean disposal.
 */
export class SocketIOProvider {
  public readonly roomId: string;
  public readonly filePath: string;
  public readonly doc: Y.Doc;
  public socket: Socket | null;
  public synced: boolean = false;

  private _onUpdateListener: (update: Uint8Array, origin: any) => void;
  private _onSyncStep2Listener?: (payload: any) => void;
  private _onUpdateSocketListener?: (payload: any) => void;
  private _onConnectListener?: () => void;
  private _isDestroyed: boolean = false;
  private _syncedListeners: Set<(synced: boolean) => void> = new Set();

  constructor(roomId: string, filePath: string, doc: Y.Doc, socket?: Socket | null) {
    this.roomId = roomId;
    this.filePath = filePath;
    this.doc = doc;
    this.socket = socket ?? null;

    // Listen to local document updates and propagate them to the socket
    this._onUpdateListener = (update: Uint8Array, origin: any) => {
      // If the origin is this provider, do not broadcast (prevents feedback loops)
      if (origin === this) return;
      if (!this.socket || !this.socket.connected) return;

      this.socket.emit("yjs_update", {
        roomId: this.roomId,
        filePath: this.filePath,
        update: update,
      });
    };

    this.doc.on("update", this._onUpdateListener);

    if (this.socket) {
      this.attachSocket(this.socket);
    }
  }

  /**
   * Attach or re-attach a Socket.IO connection.
   */
  public attachSocket(socket: Socket) {
    if (this._isDestroyed) return;
    this.detachSocket();

    this.socket = socket;

    // Handler for initial state delivery (Step 2)
    this._onSyncStep2Listener = (payload: {
      roomId: string;
      filePath: string;
      update: any;
      serverStateVector?: any;
    }) => {
      if (payload.roomId !== this.roomId || payload.filePath !== this.filePath) {
        return;
      }

      if (payload.update) {
        const binUpdate = normalizeBinary(payload.update);
        if (binUpdate.length > 0) {
          Y.applyUpdate(this.doc, binUpdate, this);
        }
      }

      // If server provided its state vector, check if client has any updates the server missed
      if (payload.serverStateVector && this.socket && this.socket.connected) {
        const sVector = normalizeBinary(payload.serverStateVector);
        const clientDiff = Y.encodeStateAsUpdate(this.doc, sVector);
        if (clientDiff.length > 2) {
          this.socket.emit("yjs_update", {
            roomId: this.roomId,
            filePath: this.filePath,
            update: clientDiff,
          });
        }
      }

      this.synced = true;
      this._syncedListeners.forEach((fn) => fn(true));
    };

    // Handler for incremental peer updates
    this._onUpdateSocketListener = (payload: {
      roomId: string;
      filePath: string;
      update: any;
    }) => {
      if (payload.roomId !== this.roomId || payload.filePath !== this.filePath) {
        return;
      }

      if (payload.update) {
        const binUpdate = normalizeBinary(payload.update);
        if (binUpdate.length > 0) {
          Y.applyUpdate(this.doc, binUpdate, this);
        }
      }
    };

    // Handler for reconnection / initial connection
    this._onConnectListener = () => {
      this.requestSync();
    };

    socket.on("yjs_sync_step2", this._onSyncStep2Listener);
    socket.on("yjs_update", this._onUpdateSocketListener);
    socket.on("connect", this._onConnectListener);

    // If already connected, initiate sync Step 1 immediately
    if (socket.connected) {
      this.requestSync();
    }
  }

  /**
   * Request synchronization by sending local state vector to server (Step 1).
   */
  public requestSync(initialContent?: string) {
    if (!this.socket || !this.socket.connected) return;

    const stateVector = Y.encodeStateVector(this.doc);
    const content = initialContent || this.doc.getText("monaco").toString();
    this.socket.emit("yjs_sync_step1", {
      roomId: this.roomId,
      filePath: this.filePath,
      stateVector: stateVector,
      initialContent: content || undefined,
    });
  }

  /**
   * Detach socket listeners without destroying the provider or document.
   */
  public detachSocket() {
    if (this.socket) {
      if (this._onSyncStep2Listener) {
        this.socket.off("yjs_sync_step2", this._onSyncStep2Listener);
      }
      if (this._onUpdateSocketListener) {
        this.socket.off("yjs_update", this._onUpdateSocketListener);
      }
      if (this._onConnectListener) {
        this.socket.off("connect", this._onConnectListener);
      }
      this.socket = null;
    }
  }

  public onSynced(callback: (synced: boolean) => void): () => void {
    this._syncedListeners.add(callback);
    if (this.synced) callback(true);
    return () => this._syncedListeners.delete(callback);
  }

  /**
   * Permanently dispose the provider and all attached listeners.
   */
  public destroy() {
    if (this._isDestroyed) return;
    this._isDestroyed = true;

    this.detachSocket();
    this.doc.off("update", this._onUpdateListener);
    this._syncedListeners.clear();
  }
}

/**
 * Workspace-level manager for multi-file collaborative documents and Monaco bindings.
 * Manages document lifetimes, guarantees one Y.Doc per workspace/file, and handles
 * clean unbinding and switching without editor corruption or duplicate subscriptions.
 */
export class YjsWorkspaceManager {
  public readonly roomId: string;
  private _socket: Socket | null = null;
  private _docs: Map<string, Y.Doc> = new Map();
  private _providers: Map<string, SocketIOProvider> = new Map();
  private _bindings: Map<string, MonacoBinding> = new Map();
  private _activeBindingPath: string | null = null;

  constructor(roomId: string, socket?: Socket | null) {
    this.roomId = roomId;
    this._socket = socket ?? null;
  }

  public setSocket(socket: Socket | null) {
    this._socket = socket;
    if (socket) {
      for (const provider of this._providers.values()) {
        provider.attachSocket(socket);
      }
    } else {
      for (const provider of this._providers.values()) {
        provider.detachSocket();
      }
    }
  }

  /**
   * Get or create a shared Y.Doc and SocketIOProvider for a given file path.
   * Ensures exactly one Y.Doc and provider instance exists per logical file identity.
   */
  public getOrCreate(filePath: string, initialContent?: string): { doc: Y.Doc; provider: SocketIOProvider } {
    let doc = this._docs.get(filePath);
    let provider = this._providers.get(filePath);

    if (!doc) {
      doc = new Y.Doc();
      if (initialContent) {
        doc.getText("monaco").insert(0, initialContent);
      }
      this._docs.set(filePath, doc);
    } else if (initialContent && doc.getText("monaco").length === 0) {
      doc.getText("monaco").insert(0, initialContent);
    }

    if (!provider) {
      provider = new SocketIOProvider(this.roomId, filePath, doc, this._socket);
      this._providers.set(filePath, provider);
      if (initialContent) {
        provider.requestSync(initialContent);
      }
    }

    return { doc, provider };
  }

  /**
   * Bind the Y.Text for a file to a Monaco editor model.
   * Safely disposes any existing binding on that file or editor first.
   */
  public bindMonaco(
    filePath: string,
    editorInstance: editor.IStandaloneCodeEditor,
    model: editor.ITextModel,
    initialContent?: string
  ): MonacoBinding {
    // 1. Unbind previous active binding if switching from another file
    if (this._activeBindingPath && this._activeBindingPath !== filePath) {
      this.unbindMonaco(this._activeBindingPath);
    }
    // Also unbind any old binding specifically for this file
    this.unbindMonaco(filePath);

    const { doc } = this.getOrCreate(filePath, initialContent);
    const ytext = doc.getText("monaco");

    // 2. CRITICAL PRE-SEEDING:
    // If ytext is empty, but model has initial text or initialContent was provided,
    // seed ytext BEFORE instantiating MonacoBinding so MonacoBinding does NOT wipe model.getValue()!
    const modelText = model.getValue();
    if (ytext.length === 0) {
      const textToSeed = initialContent || modelText;
      if (textToSeed) {
        ytext.insert(0, textToSeed);
      }
    } else {
      // If ytext has text (e.g. from server sync) and model doesn't match, update model
      const ytextStr = ytext.toString();
      if (model.getValue() !== ytextStr) {
        model.setValue(ytextStr);
      }
    }

    const binding = new MonacoBinding(
      ytext,
      model,
      new Set([editorInstance]),
      null
    );

    this._bindings.set(filePath, binding);
    this._activeBindingPath = filePath;
    return binding;
  }

  /**
   * Unbind Monaco binding for a specific file path.
   */
  public unbindMonaco(filePath: string) {
    const existing = this._bindings.get(filePath);
    if (existing) {
      try {
        existing.destroy();
      } catch (err) {
        console.warn(`[Yjs] Error destroying binding for ${filePath}:`, err);
      }
      this._bindings.delete(filePath);
    }
    if (this._activeBindingPath === filePath) {
      this._activeBindingPath = null;
    }
  }

  /**
   * Unbind all active Monaco bindings.
   */
  public unbindAllMonaco() {
    for (const [path, binding] of this._bindings.entries()) {
      try {
        binding.destroy();
      } catch (err) {
        console.warn(`[Yjs] Error destroying binding for ${path}:`, err);
      }
    }
    this._bindings.clear();
    this._activeBindingPath = null;
  }

  /**
   * Get the current text content of a file's Y.Doc synchronously.
   */
  public getText(filePath: string): string {
    const doc = this._docs.get(filePath);
    if (!doc) return "";
    return doc.getText("monaco").toString();
  }

  /**
   * Dispose resources for a deleted file.
   */
  public removeFile(filePath: string) {
    this.unbindMonaco(filePath);

    const provider = this._providers.get(filePath);
    if (provider) {
      provider.destroy();
      this._providers.delete(filePath);
    }

    const doc = this._docs.get(filePath);
    if (doc) {
      doc.destroy();
      this._docs.delete(filePath);
    }
  }

  /**
   * Fully dispose the workspace manager and all child documents, providers, and bindings.
   */
  public destroy() {
    this.unbindAllMonaco();

    for (const provider of this._providers.values()) {
      provider.destroy();
    }
    this._providers.clear();

    for (const doc of this._docs.values()) {
      doc.destroy();
    }
    this._docs.clear();
  }
}
