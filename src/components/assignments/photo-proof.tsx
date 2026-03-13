"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
import { Camera, Upload, X, ChevronLeft, ChevronRight } from "lucide-react";
import { uploadFile } from "@/lib/supabase/storage";

interface PhotoProofProps {
  assignmentId: string;
  householdId: string;
  type: "before" | "after";
  onUploaded: (url: string) => void;
  existingUrl?: string;
  className?: string;
}

export function PhotoProof({
  assignmentId,
  householdId,
  type,
  onUploaded,
  existingUrl,
  className,
}: PhotoProofProps) {
  const [preview, setPreview] = useState<string | null>(existingUrl || null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    setUploading(true);
    try {
      // Lazy-load browser-image-compression (~50KB) — only needed on upload
      const imageCompression = (await import("browser-image-compression")).default;
      const compressed = await imageCompression(file, {
        maxSizeMB: 1,
        maxWidthOrHeight: 1920,
        useWebWorker: true,
      });

      const path = `${householdId}/${assignmentId}/${type}.jpg`;
      const { path: uploadedPath, error } = await uploadFile(
        "proof-photos",
        path,
        compressed,
        { contentType: "image/jpeg", upsert: true }
      );

      if (error) throw new Error(error);

      // Revoke previous object URL to prevent memory leak
      if (preview && preview.startsWith("blob:")) {
        URL.revokeObjectURL(preview);
      }
      const url = URL.createObjectURL(compressed);
      setPreview(url);
      onUploaded(uploadedPath);
    } catch (err) {
      console.error("Upload failed:", err);
    } finally {
      setUploading(false);
    }
  };

  const handleCapture = () => {
    if (fileInputRef.current) {
      fileInputRef.current.setAttribute("capture", "environment");
      fileInputRef.current.click();
    }
  };

  const handleUpload = () => {
    if (fileInputRef.current) {
      fileInputRef.current.removeAttribute("capture");
      fileInputRef.current.click();
    }
  };

  return (
    <div className={cn("space-y-2", className)}>
      <p className="text-sm font-medium text-[var(--text-secondary)]">
        {type === "before" ? "Before Photo" : "After Photo"}
      </p>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
        }}
      />

      {preview ? (
        <div className="relative rounded-xl overflow-hidden">
          <img
            src={preview}
            alt={`${type} photo`}
            className="w-full h-48 object-cover"
          />
          <Button
            size="icon"
            variant="destructive"
            className="absolute top-2 right-2 h-8 w-8"
            onClick={() => {
              if (preview && preview.startsWith("blob:")) {
                URL.revokeObjectURL(preview);
              }
              setPreview(null);
            }}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="flex-1 h-24 rounded-xl border-dashed"
            onClick={handleCapture}
            disabled={uploading}
          >
            <div className="flex flex-col items-center gap-1">
              <Camera className="h-6 w-6" />
              <span className="text-xs">Camera</span>
            </div>
          </Button>
          <Button
            variant="outline"
            className="flex-1 h-24 rounded-xl border-dashed"
            onClick={handleUpload}
            disabled={uploading}
          >
            <div className="flex flex-col items-center gap-1">
              <Upload className="h-6 w-6" />
              <span className="text-xs">Upload</span>
            </div>
          </Button>
        </div>
      )}

      {uploading && (
        <div className="h-1 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
          <div className="h-full bg-[var(--accent-primary)] rounded-full animate-pulse w-2/3" />
        </div>
      )}
    </div>
  );
}

export function BeforeAfterSlider({
  beforeUrl,
  afterUrl,
}: {
  beforeUrl: string;
  afterUrl: string;
}) {
  const [position, setPosition] = useState(50);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMove = (clientX: number) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const pct = Math.max(0, Math.min(100, (x / rect.width) * 100));
    setPosition(pct);
  };

  return (
    <div
      ref={containerRef}
      className="relative rounded-xl overflow-hidden h-64 cursor-col-resize select-none"
      onMouseMove={(e) => {
        if (e.buttons === 1) handleMove(e.clientX);
      }}
      onTouchMove={(e) => handleMove(e.touches[0].clientX)}
    >
      {/* After (full width) */}
      <img
        src={afterUrl}
        alt="After"
        className="absolute inset-0 w-full h-full object-cover"
      />
      {/* Before (clipped) */}
      <div
        className="absolute inset-0 overflow-hidden"
        style={{ width: `${position}%` }}
      >
        <img
          src={beforeUrl}
          alt="Before"
          className="absolute inset-0 w-full h-full object-cover"
          style={{ width: containerRef.current?.offsetWidth }}
        />
      </div>
      {/* Divider */}
      <div
        className="absolute top-0 bottom-0 w-0.5 bg-white shadow-lg"
        style={{ left: `${position}%` }}
      >
        <div className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-full p-1 shadow-lg">
          <div className="flex items-center">
            <ChevronLeft className="h-3 w-3 text-zinc-800" />
            <ChevronRight className="h-3 w-3 text-zinc-800" />
          </div>
        </div>
      </div>
      {/* Labels */}
      <span className="absolute top-2 left-2 bg-black/60 text-white text-xs px-2 py-1 rounded">
        Before
      </span>
      <span className="absolute top-2 right-2 bg-black/60 text-white text-xs px-2 py-1 rounded">
        After
      </span>
    </div>
  );
}
