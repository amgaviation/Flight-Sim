/**
 * Voice callouts ("MINIMUMS", "FIVE HUNDRED", "PULL UP", "TRAFFIC, TRAFFIC"):
 * a prioritized, non-overlapping queue spoken through the Web Speech API.
 *
 * Rules (the way aural alert systems prioritise, e.g. EGPWS > TCAS > callouts):
 *  - a higher-priority callout interrupts a lower-priority one being spoken;
 *  - equal/lower priority waits in the queue (FIFO within a priority);
 *  - the same text already queued or speaking is not repeated;
 *  - queued callouts go stale after `staleS` (an altitude callout said late is wrong).
 * Without speech synthesis the fallback plays a short attention tone and
 * still reports the text (the app shows it as a caption).
 */

export interface CalloutItem {
  text: string;
  priority: number;
  /** Time queued (s, caller clock). */
  t: number;
}

export class CalloutQueue {
  current: CalloutItem | null = null;
  readonly pending: CalloutItem[] = [];
  staleS = 6;
  maxPending = 8;

  /** Returns 'interrupt' when the new item should cut the current one, 'queued' or 'duplicate'. */
  push(text: string, priority: number, now: number): 'interrupt' | 'queued' | 'duplicate' {
    const t = text.trim();
    if (!t) return 'duplicate';
    if (this.current?.text === t || this.pending.some((p) => p.text === t)) return 'duplicate';
    const item = { text: t, priority, t: now };
    if (this.current && priority > this.current.priority) {
      this.pending.unshift(item);
      this.sort();
      return 'interrupt';
    }
    this.pending.push(item);
    this.sort();
    if (this.pending.length > this.maxPending) this.pending.length = this.maxPending;
    return 'queued';
  }

  private sort(): void {
    // Stable: higher priority first, then oldest first.
    this.pending.sort((a, b) => b.priority - a.priority || a.t - b.t);
  }

  /** Next item to speak (drops stale ones), or null. Sets `current`. */
  next(now: number): CalloutItem | null {
    while (this.pending.length) {
      const it = this.pending.shift()!;
      if (now - it.t <= this.staleS) {
        this.current = it;
        return it;
      }
    }
    this.current = null;
    return null;
  }

  finish(): void {
    this.current = null;
  }

  clear(): void {
    this.current = null;
    this.pending.length = 0;
  }
}

/** Minimal Web Speech surface (lets tests inject a fake). */
export interface SpeechLike {
  speak(u: SpeechSynthesisUtterance): void;
  cancel(): void;
  getVoices(): SpeechSynthesisVoice[];
  readonly speaking: boolean;
}

export class VoiceCallouts {
  readonly queue = new CalloutQueue();
  volume = 1;
  enabled = true;
  /** Called with each callout text when it starts (captions / debug HUD). */
  onSpeak: ((text: string, priority: number) => void) | null = null;
  /** Fallback when speech is unavailable (e.g. an attention tone). */
  onFallback: ((text: string, priority: number) => void) | null = null;
  private readonly speech: SpeechLike | null;
  private voice: SpeechSynthesisVoice | null = null;
  private speakingSince = 0;
  private clock = 0;

  constructor(speech?: SpeechLike | null) {
    if (speech !== undefined) this.speech = speech;
    else this.speech = typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;
  }

  get available(): boolean {
    return this.speech !== null;
  }

  private pickVoice(): void {
    if (!this.speech || this.voice) return;
    const voices = this.speech.getVoices();
    // Prefer a clear US/UK English voice (synthetic aural warnings are English, 14 CFR 25.1322-style phrasing).
    this.voice =
      voices.find((v) => /en-US/i.test(v.lang) && /Google|Microsoft (David|Mark|Zira)|Samantha/i.test(v.name)) ??
      voices.find((v) => /^en/i.test(v.lang)) ??
      null;
  }

  say(text: string, priority = 5): void {
    if (!this.enabled) return;
    const r = this.queue.push(text, priority, this.clock);
    if (r === 'interrupt' && this.speech) {
      this.speech.cancel();
      this.queue.finish();
    }
    this.pump();
  }

  /** Per frame: advances the queue. */
  update(dt: number): void {
    this.clock += dt;
    // Safety: some engines never fire onend; release after 6 s.
    if (this.queue.current && this.clock - this.speakingSince > 6) this.queue.finish();
    this.pump();
  }

  private pump(): void {
    if (this.queue.current) return;
    const it = this.queue.next(this.clock);
    if (!it) return;
    this.speakingSince = this.clock;
    this.onSpeak?.(it.text, it.priority);
    if (!this.speech) {
      this.onFallback?.(it.text, it.priority);
      // Fallback "speech" occupies ~0.8 s so callouts do not pile up instantly.
      this.speakingSince = this.clock - 5.2;
      return;
    }
    this.pickVoice();
    try {
      const u = new SpeechSynthesisUtterance(it.text.toLowerCase());
      if (this.voice) u.voice = this.voice;
      u.rate = 1.12; // EST: synthetic aural alerts are brisk
      u.pitch = 0.95;
      u.volume = Math.max(0, Math.min(1, this.volume));
      u.onend = () => this.queue.finish();
      u.onerror = () => this.queue.finish();
      this.speech.speak(u);
    } catch {
      this.queue.finish();
      this.onFallback?.(it.text, it.priority);
    }
  }

  cancel(): void {
    this.queue.clear();
    this.speech?.cancel();
  }
}
