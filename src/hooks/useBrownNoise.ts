"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Brown-noise sensory masking, on the native Web Audio API.
 *
 * A two-second buffer is generated once and looped, which is far cheaper than
 * synthesizing continuously — and unlike an <audio> element it needs no asset,
 * so masking starts instantly and works offline.
 */

const BUFFER_SECONDS = 2;
const DEFAULT_VOLUME = 0.2;

/** Short ramp so toggling does not produce an audible pop. */
const RAMP_SECONDS = 0.12;

export interface BrownNoiseController {
  supported: boolean;
  enabled: boolean;
  volume: number;
  toggle: () => void;
  setVolume: (volume: number) => void;
}

type AudioContextCtor = typeof AudioContext;

function getAudioContextCtor(): AudioContextCtor | null {
  if (typeof window === "undefined") return null;
  return (
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: AudioContextCtor })
      .webkitAudioContext ??
    null
  );
}

/**
 * Brownian (red) noise: integrate white noise, with a leak term keeping the
 * random walk from drifting off to the rails.
 *
 * Note the ordering — `lastOut` captures the sample *before* the 3.5x output
 * gain, so the gain is applied to the output only and never re-enters the
 * feedback path. Feeding it back would let the walk diverge.
 */
function createBrownNoiseBuffer(context: AudioContext): AudioBuffer {
  const bufferSize = BUFFER_SECONDS * context.sampleRate;
  const buffer = context.createBuffer(1, bufferSize, context.sampleRate);
  const output = buffer.getChannelData(0);

  let lastOut = 0.0;
  for (let i = 0; i < bufferSize; i += 1) {
    const white = Math.random() * 2 - 1;
    output[i] = (lastOut + 0.02 * white) / 1.02;
    lastOut = output[i];
    output[i] *= 3.5;
  }

  return buffer;
}

export function useBrownNoise(): BrownNoiseController {
  const [supported, setSupported] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [volume, setVolumeState] = useState(DEFAULT_VOLUME);

  const contextRef = useRef<AudioContext | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const bufferRef = useRef<AudioBuffer | null>(null);
  const stopTimer = useRef<number | null>(null);

  useEffect(() => {
    setSupported(getAudioContextCtor() !== null);
  }, []);

  const start = useCallback(() => {
    const Ctor = getAudioContextCtor();
    if (!Ctor) return;

    if (stopTimer.current !== null) {
      window.clearTimeout(stopTimer.current);
      stopTimer.current = null;
    }

    // The context is built on the first toggle, which is a user gesture — a
    // context constructed earlier would be born suspended.
    let context = contextRef.current;
    if (!context) {
      context = new Ctor();
      contextRef.current = context;

      const gain = context.createGain();
      gain.gain.value = 0;
      gain.connect(context.destination);
      gainRef.current = gain;
    }

    void context.resume();

    if (!bufferRef.current) {
      bufferRef.current = createBrownNoiseBuffer(context);
    }

    const gain = gainRef.current;
    if (!gain) return;

    // A source node is single-use: once stopped it cannot restart, so each
    // toggle-on gets a fresh one.
    if (!sourceRef.current) {
      const source = context.createBufferSource();
      source.buffer = bufferRef.current;
      source.loop = true;
      source.connect(gain);
      source.start();
      sourceRef.current = source;
    }

    gain.gain.cancelScheduledValues(context.currentTime);
    gain.gain.setValueAtTime(gain.gain.value, context.currentTime);
    gain.gain.linearRampToValueAtTime(volume, context.currentTime + RAMP_SECONDS);
  }, [volume]);

  const stop = useCallback(() => {
    const context = contextRef.current;
    const gain = gainRef.current;
    const source = sourceRef.current;
    if (!context || !gain || !source) return;

    gain.gain.cancelScheduledValues(context.currentTime);
    gain.gain.setValueAtTime(gain.gain.value, context.currentTime);
    gain.gain.linearRampToValueAtTime(0, context.currentTime + RAMP_SECONDS);

    // Let the fade finish before tearing the node down, or the ramp is pointless.
    stopTimer.current = window.setTimeout(
      () => {
        try {
          source.stop();
        } catch {
          // Already stopped; nothing to do.
        }
        source.disconnect();
        sourceRef.current = null;
        stopTimer.current = null;
      },
      RAMP_SECONDS * 1000 + 40
    );
  }, []);

  useEffect(() => {
    if (enabled) start();
    else stop();
  }, [enabled, start, stop]);

  useEffect(() => {
    return () => {
      if (stopTimer.current !== null) window.clearTimeout(stopTimer.current);
      sourceRef.current?.disconnect();
      void contextRef.current?.close();
      contextRef.current = null;
      gainRef.current = null;
      sourceRef.current = null;
      bufferRef.current = null;
    };
  }, []);

  const setVolume = useCallback((next: number) => {
    const clamped = Math.min(1, Math.max(0, next));
    setVolumeState(clamped);

    const context = contextRef.current;
    const gain = gainRef.current;
    // Ramp rather than assign: a step change in gain is audible as a click.
    if (context && gain && sourceRef.current) {
      gain.gain.cancelScheduledValues(context.currentTime);
      gain.gain.setTargetAtTime(clamped, context.currentTime, 0.02);
    }
  }, []);

  const toggle = useCallback(() => setEnabled((on) => !on), []);

  return { supported, enabled, volume, toggle, setVolume };
}
