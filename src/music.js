export const MUSIC_TRACKS = [
  "lobby",
  "christmas",
  "underwater",
  "forest",
  "jungle",
  "podium",
];
export const REPEAT_GAP_SECONDS = 1.75;
export const PODIUM_LOOP = { start: 25, end: 35 };

// Silence is part of the decoded loop buffer, so repeats don't depend on timers
// (which mobile browsers can throttle). No network requests happen on playback.
export function withRepeatGap(context, decoded) {
  const loop = context.createBuffer(
    decoded.numberOfChannels,
    decoded.length + Math.round(REPEAT_GAP_SECONDS * decoded.sampleRate),
    decoded.sampleRate,
  );
  for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
    loop.copyToChannel(decoded.getChannelData(channel), channel);
  }
  return loop;
}

export class RoomMusic {
  constructor({
    createContext,
    fetchAudio = (...args) => fetch(...args),
  } = {}) {
    this.createContext =
      createContext ??
      (() => {
        const Context = window.AudioContext || window.webkitAudioContext;
        return new Context();
      });
    this.fetchAudio = fetchAudio;
    this.enabled = true;
    this.track = null;
    this.buffers = new Map();
    this.source = null;
    this.unlocked = false;
  }

  initialize() {
    this.context ??= this.createContext();
    if (!this.gain) {
      this.gain = this.context.createGain();
      this.gain.gain.value = 0.28;
      this.gain.connect(this.context.destination);
    }
  }

  async preload(audioUrl, onLoaded = () => {}) {
    this.initialize();
    await Promise.all(
      MUSIC_TRACKS.map(async (track) => {
        if (!this.buffers.has(track)) {
          const response = await this.fetchAudio(audioUrl(track));
          if (!response.ok) throw Error(`Music could not load: ${track}`);
          const decoded = await this.context.decodeAudioData(
            await response.arrayBuffer(),
          );
          this.buffers.set(track, withRepeatGap(this.context, decoded));
        }
        onLoaded();
      }),
    );
    if (this.context.state === "running") this.unlocked = true;
    this.play();
  }

  // Call synchronously from a real user interaction, before awaiting anything.
  unlock() {
    this.initialize();
    this.unlocked = true;
    const resumed = this.context.resume();
    resumed?.then(() => this.play()).catch(() => {
      this.unlocked = false;
    });
    this.play();
  }

  setTrack(track) {
    if (this.track === track) return;
    this.stop();
    this.track = track;
    this.play();
  }

  toggle() {
    this.enabled = !this.enabled;
    if (this.enabled) this.unlock();
    else this.stop();
    return this.enabled;
  }

  play() {
    if (!this.enabled || !this.unlocked || !this.track || this.source) return;
    const buffer = this.buffers.get(this.track);
    if (!buffer) return;
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    if (this.track === "podium") {
      source.loopStart = PODIUM_LOOP.start;
      source.loopEnd = PODIUM_LOOP.end;
    }
    source.connect(this.gain);
    source.start();
    this.source = source;
  }

  stop() {
    if (!this.source) return;
    this.source.stop();
    this.source.disconnect();
    this.source = null;
  }
}
