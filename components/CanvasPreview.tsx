"use client";

import React, { useRef, useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { 
  MonitorPlay, 
  Volume2, 
  VolumeX, 
  ChevronLeft, 
  ChevronRight, 
  RotateCcw, 
  Eye, 
  EyeOff, 
  Music,
  Smartphone
} from "lucide-react";
import { CanvasRenderer } from "@/lib/canvas/renderer";

export function CanvasPreview() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const animationRef = useRef<number>(0);
  const startTimeRef = useRef<number>(0);

  const { queue, previewItemId, setPreviewItemId, audioFiles } = useStore();

  const [isMuted, setIsMuted] = useState(false);
  const [showSafeZone, setShowSafeZone] = useState(true);

  const currentIndex = queue.findIndex((q) => q.id === previewItemId);
  const previewItem = currentIndex !== -1 ? queue[currentIndex] : undefined;
  const currentAudioFile =
    previewItem && audioFiles.length > 0 && currentIndex !== -1
      ? audioFiles[currentIndex % audioFiles.length]
      : null;

  // Handle mute toggle
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.muted = isMuted;
    }
  }, [isMuted]);

  // Dedicated effect for audio playback, isolated from canvas updates
  useEffect(() => {
    if (!currentAudioFile) {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = "";
        audioRef.current = null;
      }
      return;
    }

    const objectUrl = URL.createObjectURL(currentAudioFile);
    const audio = new Audio(objectUrl);
    audio.loop = true;
    audio.muted = isMuted;
    audioRef.current = audio;

    let isCancelled = false;
    const playPromise = audio.play();
    if (playPromise !== undefined) {
      playPromise.catch((e) => {
        // Ignore AbortError caused by navigation or unmounting
        if (e.name === "AbortError" || isCancelled) {
          return;
        }
        console.warn("Audio playback prevented by browser policy:", e);
      });
    }

    return () => {
      isCancelled = true;
      if (audioRef.current === audio) {
        audioRef.current = null;
      }
      if (playPromise !== undefined) {
        playPromise
          .then(() => {
            audio.pause();
            audio.src = "";
            URL.revokeObjectURL(objectUrl);
          })
          .catch(() => {
            audio.pause();
            audio.src = "";
            URL.revokeObjectURL(objectUrl);
          });
      } else {
        audio.pause();
        audio.src = "";
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [currentAudioFile]);

  // Dedicated effect for canvas rendering loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (!previewItem) {
      // Draw idle state
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "#0a0a0a";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#525252";
      ctx.font = "bold 44px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("Select an item to preview", canvas.width / 2, canvas.height / 2);
      return;
    }

    let artistName: string | undefined = undefined;
    let songName: string | undefined = undefined;

    if (audioFiles.length > 0 && currentIndex !== -1) {
      const file = audioFiles[currentIndex % audioFiles.length];
      const baseName = file.name.replace(/\.[^/.]+$/, "");
      if (baseName.includes(" - ")) {
        const parts = baseName.split(" - ");
        artistName = parts[0].trim();
        songName = parts.slice(1).join(" - ").trim();
      } else {
        songName = baseName;
      }
    }

    try {
      const renderer = new CanvasRenderer(canvas);
      startTimeRef.current = performance.now();

      const renderLoop = (timestamp: number) => {
        const timeMs = timestamp - startTimeRef.current;
        renderer.renderFrame(previewItem, timeMs, artistName, songName);
        animationRef.current = requestAnimationFrame(renderLoop);
      };

      animationRef.current = requestAnimationFrame(renderLoop);
    } catch (e) {
      console.error(e);
    }

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [previewItem, currentIndex, audioFiles.length]);

  const handleRestart = () => {
    startTimeRef.current = performance.now();
    if (audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch((e) => {
        if (e.name !== "AbortError") {
          console.warn("Audio playback prevented by browser policy:", e);
        }
      });
    }
  };

  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex !== -1 && currentIndex < queue.length - 1;

  const handlePrev = () => {
    if (hasPrev) {
      setPreviewItemId(queue[currentIndex - 1].id);
    }
  };

  const handleNext = () => {
    if (hasNext) {
      setPreviewItemId(queue[currentIndex + 1].id);
    }
  };

  const currentAudioName =
    previewItem && audioFiles.length > 0
      ? audioFiles[currentIndex % audioFiles.length]?.name.replace(/\.[^/.]+$/, "")
      : null;

  return (
    <div className="bg-neutral-900/80 border border-neutral-800 rounded-xl p-3 sm:p-3.5 shadow-sm flex flex-col h-full min-h-0 max-h-full overflow-hidden justify-between gap-2.5 w-full max-w-[360px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between pb-2 border-b border-neutral-800 shrink-0">
        <div className="flex items-center gap-2 text-sm font-semibold text-neutral-100">
          <MonitorPlay className="w-4 h-4 text-neutral-400" />
          <h2>Live Preview</h2>
        </div>
        <span className="text-[10px] font-mono text-neutral-400 bg-neutral-800 px-2 py-0.5 rounded border border-neutral-700">
          1080×1920
        </span>
      </div>

      {/* Preview Viewport Frame */}
      <div className="flex-1 min-h-0 flex items-center justify-center w-full p-0.5 sm:p-1 overflow-hidden">
        <div className="relative aspect-[9/16] h-full max-h-full w-auto max-w-full rounded-2xl overflow-hidden border-2 border-neutral-800 bg-black shadow-2xl flex items-center justify-center">
          <canvas
            ref={canvasRef}
            width={1080}
            height={1920}
            className="w-full h-full object-contain pointer-events-none"
          />

          {/* Safe-Zone Guide Overlay */}
          {previewItem && showSafeZone && (
            <div className="absolute inset-0 pointer-events-none border border-neutral-600/30 m-2.5 sm:m-3 rounded-xl flex flex-col justify-between p-2">
              <div className="text-[9px] font-mono text-neutral-500 bg-black/60 px-1.5 py-0.5 rounded self-start">
                Top Safe Margin (150px)
              </div>
              <div className="flex justify-between items-end">
                <div className="text-[9px] font-mono text-neutral-500 bg-black/60 px-1.5 py-0.5 rounded">
                  Caption Safe Zone
                </div>
                <div className="text-[9px] font-mono text-neutral-500 bg-black/60 px-1.5 py-0.5 rounded">
                  Action Bar
                </div>
              </div>
            </div>
          )}

          {/* Current Track Pill Overlay */}
          {previewItem && currentAudioName && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 max-w-[85%] pointer-events-none">
              <div className="flex items-center gap-1.5 bg-black/70 backdrop-blur-md border border-neutral-700/60 px-2.5 py-1 rounded-full text-[10px] text-neutral-200 truncate">
                <Music className="w-3 h-3 text-emerald-400 shrink-0 animate-pulse" />
                <span className="truncate">{currentAudioName}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Preview Controls Bar */}
      {previewItem && (
        <div className="flex flex-col gap-2 pt-2 border-t border-neutral-800 shrink-0">
          <div className="flex items-center justify-between">
            {/* Prev / Next Queue Navigation */}
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handlePrev}
                disabled={!hasPrev}
                className="p-1.5 rounded-lg bg-neutral-950 border border-neutral-800 hover:border-neutral-700 disabled:opacity-30 text-neutral-300 transition-colors cursor-pointer disabled:cursor-not-allowed"
                title="Previous video"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-[11px] font-mono text-neutral-400 px-1.5">
                {currentIndex + 1} / {queue.length}
              </span>
              <button
                type="button"
                onClick={handleNext}
                disabled={!hasNext}
                className="p-1.5 rounded-lg bg-neutral-950 border border-neutral-800 hover:border-neutral-700 disabled:opacity-30 text-neutral-300 transition-colors cursor-pointer disabled:cursor-not-allowed"
                title="Next video"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            {/* Audio and Guideline Toggles */}
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleRestart}
                className="p-1.5 rounded-lg bg-neutral-950 border border-neutral-800 hover:border-neutral-700 text-neutral-400 hover:text-neutral-200 transition-colors cursor-pointer"
                title="Restart animation & audio"
              >
                <RotateCcw className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={() => setShowSafeZone(!showSafeZone)}
                className={`p-1.5 rounded-lg border transition-colors cursor-pointer ${
                  showSafeZone
                    ? "bg-blue-600/20 border-blue-500/40 text-blue-400"
                    : "bg-neutral-950 border-neutral-800 text-neutral-500 hover:text-neutral-300"
                }`}
                title={showSafeZone ? "Hide safe-zone guide" : "Show safe-zone guide"}
              >
                {showSafeZone ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
              </button>

              <button
                type="button"
                onClick={() => setIsMuted(!isMuted)}
                className={`p-1.5 rounded-lg border transition-colors cursor-pointer ${
                  !isMuted
                    ? "bg-emerald-600/20 border-emerald-500/40 text-emerald-400"
                    : "bg-neutral-950 border-neutral-800 text-neutral-500 hover:text-neutral-300"
                }`}
                title={isMuted ? "Unmute audio" : "Mute audio"}
              >
                {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
