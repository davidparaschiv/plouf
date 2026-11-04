import { test } from "node:test";
import assert from "node:assert/strict";
import { RoomMusic, MUSIC_TRACKS, withRepeatGap } from "../src/music.js";

function buffer(channels = 2, length = 16, sampleRate = 8) {
  const samples = Array.from(
    { length: channels },
    () => new Float32Array(length),
  );
  return {
    numberOfChannels: channels,
    length,
    sampleRate,
    getChannelData: (channel) => samples[channel],
    copyToChannel: (source, channel) => samples[channel].set(source),
  };
}

test("every channel preserves the song and appends exactly 1.75 seconds of silence", () => {
  const decoded = buffer();
  decoded.getChannelData(0).fill(0.5);
  decoded.getChannelData(1).fill(-0.25);
  const loop = withRepeatGap({ createBuffer: buffer }, decoded);
  assert.equal(loop.length - decoded.length, 14);
  for (let channel = 0; channel < 2; channel++) {
    assert.deepEqual(
      loop.getChannelData(channel).slice(0, 16),
      decoded.getChannelData(channel),
    );
    assert.ok(
      loop
        .getChannelData(channel)
        .slice(16)
        .every((value) => value === 0),
    );
  }
});

test("all five songs preload once; muting and track changes do not fetch or overlap songs", async () => {
  const sources = [];
  let fetched = 0,
    loaded = 0;
  const context = {
    destination: {},
    createBuffer: buffer,
    createGain: () => ({ gain: { value: 0 }, connect() {} }),
    decodeAudioData: async () => buffer(),
    resume: async () => {},
    createBufferSource: () => {
      const source = {
        starts: 0,
        stops: 0,
        connect() {},
        disconnect() {},
        start() {
          this.starts++;
        },
        stop() {
          this.stops++;
        },
      };
      sources.push(source);
      return source;
    },
  };
  const music = new RoomMusic({
    createContext: () => context,
    fetchAudio: async () => {
      fetched++;
      return { ok: true, arrayBuffer: async () => new ArrayBuffer(0) };
    },
  });
  assert.equal(music.enabled, true);
  await music.preload(
    (track) => track,
    () => loaded++,
  );
  assert.equal(fetched, 5);
  assert.equal(loaded, 5);
  assert.deepEqual([...music.buffers.keys()].sort(), [...MUSIC_TRACKS].sort());
  music.setTrack("lobby");
  assert.equal(sources.length, 0, "wait for a user interaction");
  music.unlock();
  assert.equal(sources.length, 1);
  assert.equal(sources[0].loop, true);
  music.setTrack("lobby");
  music.unlock();
  assert.equal(sources.length, 1, "polling and taps must not restart music");
  music.setTrack("forest");
  assert.equal(sources[0].stops, 1);
  assert.equal(sources.length, 2);
  music.toggle();
  assert.equal(music.enabled, false);
  assert.equal(sources[1].stops, 1);
  music.setTrack("podium");
  assert.equal(sources.length, 2, "mute survives screen changes");
  music.toggle();
  assert.equal(music.enabled, true);
  assert.equal(sources.length, 3);
  assert.equal(sources[2].buffer, music.buffers.get("podium"));
  await music.preload((track) => track);
  assert.equal(fetched, 5, "music is reused from decoded buffers");
});
