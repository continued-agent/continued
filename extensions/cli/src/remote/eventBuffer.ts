import {
  REMOTE_PROTOCOL_VERSION,
  type SequencedServerEvent,
  type SessionEventPayload,
} from "./types.js";

export interface ReplayResult {
  events: SequencedServerEvent[];
  resyncRequired: boolean;
}

export class SessionEventBuffer {
  private readonly events: SequencedServerEvent[] = [];
  private nextSequence = 0;

  constructor(private readonly capacity = 256) {}

  get lastSequence(): number {
    return this.nextSequence;
  }

  append(payload: SessionEventPayload): SequencedServerEvent {
    const event = {
      ...payload,
      v: REMOTE_PROTOCOL_VERSION,
      seq: ++this.nextSequence,
      ts: new Date().toISOString(),
    } as SequencedServerEvent;
    this.events.push(event);
    if (this.events.length > this.capacity) {
      this.events.splice(0, this.events.length - this.capacity);
    }
    return event;
  }

  replayAfter(afterSequence: number): ReplayResult {
    const firstAvailable = this.events[0]?.seq ?? this.nextSequence + 1;
    return {
      events: this.events.filter((event) => event.seq > afterSequence),
      resyncRequired:
        afterSequence < firstAvailable - 1 && this.nextSequence > 0,
    };
  }
}
