import * as Mp4Muxer from 'mp4-muxer';

export interface EncodeVideoOptions {
  canvas?: HTMLCanvasElement;
  canvasWidth: number;
  canvasHeight: number;
  fps: number;
  durationSeconds: number;
  audioBuffer?: AudioBuffer;
  renderFrame: (ctx: CanvasRenderingContext2D, timeMs: number) => void;
}

/**
 * Finds a supported AVC/H.264 video encoder configuration using VideoEncoder.isConfigSupported.
 * Tests preferred profiles and levels with fallback from hardware to software acceleration.
 */
async function getSupportedVideoConfig(
  width: number,
  height: number,
  fps: number,
  bitrate: number,
  preferredAccel: HardwareAcceleration = 'prefer-hardware'
): Promise<VideoEncoderConfig> {
  const candidateCodecs = [
    'avc1.420034', // Baseline Profile, Level 5.2 (optimal compatibility for 1080x1920 vertical)
    'avc1.4d0034', // Main Profile, Level 5.2
    'avc1.640034', // High Profile, Level 5.2
    'avc1.420033', // Baseline Profile, Level 5.1
    'avc1.4d0033', // Main Profile, Level 5.1
    'avc1.640033', // High Profile, Level 5.1
    'avc1.420028', // Baseline Profile, Level 4.0
    'avc1.4d002a', // Main Profile, Level 4.2
    'avc1.42001f', // Baseline Profile, Level 3.1
  ];

  const accelOptions: HardwareAcceleration[] = [
    preferredAccel,
    preferredAccel === 'prefer-hardware' ? 'no-preference' : 'prefer-software',
    'prefer-software',
  ];

  for (const accel of accelOptions) {
    for (const codec of candidateCodecs) {
      const config: VideoEncoderConfig = {
        codec,
        width,
        height,
        bitrate,
        framerate: fps,
        hardwareAcceleration: accel,
      };

      try {
        if (typeof VideoEncoder !== 'undefined' && typeof VideoEncoder.isConfigSupported === 'function') {
          const res = await VideoEncoder.isConfigSupported(config);
          if (res.supported && res.config) {
            return res.config;
          }
        }
      } catch {
        // Continue searching
      }
    }
  }

  // Safe fallback if isConfigSupported isn't available or none explicitly reported true
  return {
    codec: 'avc1.420034',
    width,
    height,
    bitrate,
    framerate: fps,
    hardwareAcceleration: preferredAccel,
  };
}

/**
 * Runs the internal encoding pipeline with backpressure and error detection.
 */
async function runEncoding(
  options: EncodeVideoOptions,
  preferredAccel: HardwareAcceleration
): Promise<Blob> {
  const { canvas, canvasWidth, canvasHeight, fps, durationSeconds, audioBuffer, renderFrame } = options;

  const muxer = new Mp4Muxer.Muxer({
    target: new Mp4Muxer.ArrayBufferTarget(),
    video: {
      codec: 'avc',
      width: canvasWidth,
      height: canvasHeight,
    },
    audio: audioBuffer
      ? {
          codec: 'aac',
          numberOfChannels: audioBuffer.numberOfChannels,
          sampleRate: audioBuffer.sampleRate,
        }
      : undefined,
    fastStart: 'in-memory',
  });

  let encoderError: Error | null = null;

  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => {
      console.error('VideoEncoder error:', e);
      encoderError = e instanceof Error ? e : new Error(String(e));
    },
  });

  const videoConfig = await getSupportedVideoConfig(canvasWidth, canvasHeight, fps, 5_000_000, preferredAccel);
  videoEncoder.configure(videoConfig);

  // Handle audio encoding with backpressure if audioBuffer is provided
  if (audioBuffer) {
    let audioEncoderError: Error | null = null;

    const audioEncoder = new AudioEncoder({
      output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
      error: (e) => {
        console.error('AudioEncoder error:', e);
        audioEncoderError = e instanceof Error ? e : new Error(String(e));
      },
    });

    const audioConfig: AudioEncoderConfig = {
      codec: 'mp4a.40.2',
      sampleRate: audioBuffer.sampleRate,
      numberOfChannels: audioBuffer.numberOfChannels,
      bitrate: 128_000,
    };

    audioEncoder.configure(audioConfig);

    const length = audioBuffer.length;
    const sampleRate = audioBuffer.sampleRate;
    const numberOfChannels = audioBuffer.numberOfChannels;
    const chunkSize = 1024;

    for (let i = 0; i < length; i += chunkSize) {
      if (audioEncoderError) {
        throw audioEncoderError;
      }

      // Backpressure check for audio encoder
      while (audioEncoder.encodeQueueSize > 8) {
        if (audioEncoderError) throw audioEncoderError;
        await new Promise<void>((resolve) => {
          const onDequeue = () => {
            audioEncoder.removeEventListener('dequeue', onDequeue);
            resolve();
          };
          audioEncoder.addEventListener('dequeue', onDequeue);
          setTimeout(() => {
            audioEncoder.removeEventListener('dequeue', onDequeue);
            resolve();
          }, 10);
        });
      }

      const framesToProcess = Math.min(chunkSize, length - i);
      const timestampUs = Math.round((i / sampleRate) * 1_000_000);

      const planarData = new Float32Array(framesToProcess * numberOfChannels);
      for (let c = 0; c < numberOfChannels; c++) {
        const channelData = audioBuffer.getChannelData(c);
        const offset = c * framesToProcess;
        for (let j = 0; j < framesToProcess; j++) {
          planarData[offset + j] = channelData[i + j];
        }
      }

      const audioData = new AudioData({
        format: 'f32-planar',
        sampleRate: sampleRate,
        numberOfFrames: framesToProcess,
        numberOfChannels: numberOfChannels,
        timestamp: timestampUs,
        data: planarData,
      });

      audioEncoder.encode(audioData);
      audioData.close();
    }

    await audioEncoder.flush();
    audioEncoder.close();
  }

  // Handle video encoding with backpressure
  const encodeCanvas = canvas || document.createElement('canvas');
  encodeCanvas.width = canvasWidth;
  encodeCanvas.height = canvasHeight;
  const ctx = encodeCanvas.getContext('2d');

  if (!ctx) {
    throw new Error('Failed to get 2D context from canvas');
  }

  const totalFrames = Math.round(durationSeconds * fps);
  for (let i = 0; i < totalFrames; i++) {
    if (encoderError) {
      throw encoderError;
    }

    // Backpressure: prevent flooding the VideoEncoder queue which causes OperationError
    while (videoEncoder.encodeQueueSize > 4) {
      if (encoderError) throw encoderError;
      await new Promise<void>((resolve) => {
        const onDequeue = () => {
          videoEncoder.removeEventListener('dequeue', onDequeue);
          resolve();
        };
        videoEncoder.addEventListener('dequeue', onDequeue);
        setTimeout(() => {
          videoEncoder.removeEventListener('dequeue', onDequeue);
          resolve();
        }, 10);
      });
    }

    const timeMs = (i / fps) * 1000;
    renderFrame(ctx, timeMs);

    const timestampUs = Math.round((i * 1_000_000) / fps);
    const videoFrame = new VideoFrame(encodeCanvas, { timestamp: timestampUs });
    const keyFrame = i % fps === 0;

    try {
      videoEncoder.encode(videoFrame, { keyFrame });
    } finally {
      videoFrame.close();
    }

    // Periodically yield to event loop so browser stays responsive and UI updates
    if (i % 15 === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  if (encoderError) {
    throw encoderError;
  }

  await videoEncoder.flush();
  videoEncoder.close();

  muxer.finalize();

  const buffer = (muxer.target as Mp4Muxer.ArrayBufferTarget).buffer;
  return new Blob([buffer], { type: 'video/mp4' });
}

/**
 * Encodes video frames and optional audio into an MP4 blob.
 * Automatically handles backpressure and falls back to software encoding if hardware acceleration fails.
 */
export async function encodeVideo(options: EncodeVideoOptions): Promise<Blob> {
  try {
    return await runEncoding(options, 'prefer-hardware');
  } catch (err: any) {
    const errMsg = String(err?.message || err);
    if (err?.name === 'OperationError' || errMsg.includes('Encoding error') || errMsg.includes('OperationError')) {
      console.warn('Hardware video encoding failed, falling back to software encoding...', err);
      return await runEncoding(options, 'prefer-software');
    }
    throw err;
  }
}
