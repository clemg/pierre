// Minimal Chrome DevTools Protocol client: one WebSocket to the browser
// endpoint, with page sessions multiplexed over it via flat sessionIds. This
// is all the bench runner needs — no Playwright/puppeteer dependency.

export interface CDPEvent {
  method: string;
  params: Record<string, unknown>;
  sessionId?: string;
}

interface PendingCommand {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

export class CDPConnection {
  private ws: WebSocket;
  private nextId = 1;
  private pending = new Map<number, PendingCommand>();
  private eventHandlers = new Set<(event: CDPEvent) => void>();
  onClose?: () => void;

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.onmessage = (message) => this.handleMessage(String(message.data));
    ws.onclose = () => {
      for (const command of this.pending.values()) {
        command.reject(new Error('CDP connection closed'));
      }
      this.pending.clear();
      this.onClose?.();
    };
  }

  static connect(url: string): Promise<CDPConnection> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.onopen = () => resolve(new CDPConnection(ws));
      ws.onerror = () => reject(new Error(`CDP connect failed: ${url}`));
    });
  }

  send(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string
  ): Promise<any> {
    const id = this.nextId++;
    const promise = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    return promise;
  }

  onEvent(handler: (event: CDPEvent) => void): void {
    this.eventHandlers.add(handler);
  }

  close(): void {
    try {
      this.ws.close();
    } catch {
      // already closed
    }
  }

  private handleMessage(data: string): void {
    const message = JSON.parse(data);
    if (message.id != null) {
      const command = this.pending.get(message.id);
      if (command == null) {
        return;
      }
      this.pending.delete(message.id);
      if (message.error != null) {
        command.reject(
          new Error(`${message.method ?? ''} ${message.error.message}`)
        );
      } else {
        command.resolve(message.result);
      }
    } else if (message.method != null) {
      for (const handler of this.eventHandlers) {
        handler(message as CDPEvent);
      }
    }
  }
}
