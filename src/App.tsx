import { useState, useCallback, useRef, useEffect, type DragEvent, type ChangeEvent } from "react";
import { saveAs } from "file-saver";
import "./App.css";

type OutputFormat = "image/jpeg" | "image/png";
type QualityPreset = "low" | "mid" | "high" | "custom";
type ResizeMode = "none" | "width" | "height";

interface PixelDimensions {
  width: number;
  height: number;
}

interface FileEntry {
  id: string;
  file: File;
  name: string;
  size: number;
  status: "pending" | "converting" | "done" | "error";
  error?: string;
  resultBlob?: Blob;
  resultName?: string;
  sourceDimensions?: PixelDimensions;
  resultDimensions?: PixelDimensions;
}

const QUALITY_MAP: Record<Exclude<QualityPreset, "custom">, number> = {
  low: 0.3,
  mid: 0.6,
  high: 0.92,
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function getExtension(format: OutputFormat): string {
  return format === "image/jpeg" ? ".jpg" : ".png";
}

function formatDimensions(dimensions: PixelDimensions): string {
  return `${dimensions.width}x${dimensions.height}`;
}

function getDimensionsLabel(entry: FileEntry): string | null {
  if (!entry.sourceDimensions) return null;
  if (!entry.resultDimensions) return formatDimensions(entry.sourceDimensions);

  const sourceLabel = formatDimensions(entry.sourceDimensions);
  const resultLabel = formatDimensions(entry.resultDimensions);
  return sourceLabel === resultLabel ? sourceLabel : `${sourceLabel} -> ${resultLabel}`;
}

function replaceExtension(name: string, format: OutputFormat): string {
  return name.replace(/\.[^.]+$/, getExtension(format));
}

async function readImageDimensions(blob: Blob): Promise<PixelDimensions> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to read image dimensions"));
    };
    img.src = url;
  });
}

async function resizeBlob(
  blob: Blob,
  format: OutputFormat,
  quality: number,
  resizeMode: ResizeMode,
  resizeValue: number,
  sourceDimensions: PixelDimensions
): Promise<{ blob: Blob; dimensions: PixelDimensions }> {
  if (resizeMode === "none") {
    if (format === "image/png") return { blob, dimensions: sourceDimensions };
    // Re-encode JPEG with chosen quality
    return {
      blob: await reencodeBlob(blob, format, quality),
      dimensions: sourceDimensions,
    };
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let w = img.naturalWidth;
      let h = img.naturalHeight;

      if (resizeMode === "width" && resizeValue > 0 && resizeValue < w) {
        const ratio = resizeValue / w;
        w = resizeValue;
        h = Math.round(h * ratio);
      } else if (resizeMode === "height" && resizeValue > 0 && resizeValue < h) {
        const ratio = resizeValue / h;
        h = resizeValue;
        w = Math.round(w * ratio);
      }

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob(
        (result) => {
          if (result) {
            resolve({
              blob: result,
              dimensions: { width: w, height: h },
            });
          }
          else reject(new Error("Canvas toBlob failed"));
        },
        format,
        format === "image/jpeg" ? quality : undefined
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load image for resizing"));
    };
    img.src = url;
  });
}

async function reencodeBlob(
  blob: Blob,
  format: OutputFormat,
  quality: number
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      canvas.toBlob(
        (result) => {
          if (result) resolve(result);
          else reject(new Error("Canvas toBlob failed"));
        },
        format,
        format === "image/jpeg" ? quality : undefined
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load image"));
    };
    img.src = url;
  });
}

let idCounter = 0;
let heicToModule: any = null;

function App() {
  const [isReady, setIsReady] = useState(false);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [format, setFormat] = useState<OutputFormat>("image/jpeg");
  const [qualityPreset, setQualityPreset] = useState<QualityPreset>("high");
  const [customQuality, setCustomQuality] = useState(85);
  const [resizeMode, setResizeMode] = useState<ResizeMode>("none");
  const [resizeValue, setResizeValue] = useState(1920);
  const [converting, setConverting] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const quality =
    qualityPreset === "custom" ? customQuality / 100 : QUALITY_MAP[qualityPreset];

  // Asynchronously load the heavy heic-to module
  useEffect(() => {
    import("heic-to").then((module) => {
      heicToModule = module.heicTo;
      setIsReady(true);
    }).catch(err => {
      console.error("Failed to load heic-to module:", err);
    });
  }, []);

  // Invalidate completed/errored files and send them back to pending when settings change 
  // so they can be re-converted and we don't accidentally download stale conversions.
  useEffect(() => {
    setFiles((prev) => {
      const needsReset = prev.some((f) => f.status === "done" || f.status === "error");
      if (!needsReset) return prev;

      return prev.map((f) =>
        f.status === "done" || f.status === "error"
          ? {
              ...f,
              status: "pending",
              resultBlob: undefined,
              resultName: undefined,
              resultDimensions: undefined,
              error: undefined,
            }
          : f
      );
    });
  }, [format, qualityPreset, customQuality, resizeMode, resizeValue]);

  const addFiles = useCallback((fileList: FileList) => {
    const heicFiles = Array.from(fileList).filter(
      (f) =>
        f.name.toLowerCase().endsWith(".heic") ||
        f.name.toLowerCase().endsWith(".heif") ||
        f.type === "image/heic" ||
        f.type === "image/heif"
    );
    const entries: FileEntry[] = heicFiles.map((f) => ({
      id: String(++idCounter),
      file: f,
      name: f.name,
      size: f.size,
      status: "pending" as const,
    }));
    setFiles((prev) => [...prev, ...entries]);
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);
      if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
    },
    [addFiles]
  );

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  }, []);

  const handleFileInput = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      if (e.target.files?.length) addFiles(e.target.files);
      e.target.value = "";
    },
    [addFiles]
  );

  const convertAll = useCallback(async () => {
    setConverting(true);
    const pending = files.filter((f) => f.status === "pending");

    for (const entry of pending) {
      setFiles((prev) =>
        prev.map((f) => (f.id === entry.id ? { ...f, status: "converting" } : f))
      );

      try {
        if (!heicToModule) throw new Error("heic-to module not loaded");
        const buffer = await entry.file.arrayBuffer();
        const fileBlob = new Blob([buffer]);

        const converted = await heicToModule({
          blob: fileBlob,
          type: format,
          quality: format === "image/jpeg" ? quality : undefined,
        });

        // heic-to returns a Blob directly
        const blob = converted as Blob;
        const sourceDimensions = await readImageDimensions(blob);

        setFiles((prev) =>
          prev.map((f) =>
            f.id === entry.id
              ? { ...f, sourceDimensions, resultDimensions: undefined, error: undefined }
              : f
          )
        );

        const resized = await resizeBlob(
          blob,
          format,
          quality,
          resizeMode,
          resizeValue,
          sourceDimensions
        );
        const resultName = replaceExtension(entry.name, format);

        setFiles((prev) =>
          prev.map((f) =>
            f.id === entry.id
              ? {
                  ...f,
                  status: "done",
                  resultBlob: resized.blob,
                  resultName,
                  sourceDimensions,
                  resultDimensions: resized.dimensions,
                }
              : f
          )
        );
      } catch (err) {
        setFiles((prev) =>
          prev.map((f) =>
            f.id === entry.id
              ? { ...f, status: "error", error: String(err) }
              : f
          )
        );
      }
    }

    setConverting(false);
  }, [files, format, quality, resizeMode, resizeValue]);

  const downloadSingle = (entry: FileEntry) => {
    if (entry.resultBlob && entry.resultName) {
      saveAs(entry.resultBlob, entry.resultName);
    }
  };

  const downloadAll = () => {
    const done = files.filter((f) => f.status === "done");
    done.forEach((f) => {
      if (f.resultBlob && f.resultName) saveAs(f.resultBlob, f.resultName);
    });
  };

  const clearAll = () => {
    setFiles([]);
  };

  const removeFile = (id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  };

  const pendingCount = files.filter((f) => f.status === "pending").length;
  const doneCount = files.filter((f) => f.status === "done").length;
  const totalCount = files.length;
  const progress = totalCount > 0 ? ((totalCount - pendingCount) / totalCount) * 100 : 0;

  if (!isReady) {
    return (
      <div className="app" style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh" }}>
        <p style={{ fontSize: "1.2rem", fontFamily: "IBM Plex Mono, monospace" }}>
          Loading engine...
        </p>
      </div>
    );
  }

  return (
    <div className="app">
      <h1>HEIC → {format === "image/jpeg" ? "JPEG" : "PNG"}</h1>
      <p style={{ marginBottom: "1.5em" }}>
        Drop your HEIC/HEIF files below to convert them. Everything runs in
        your browser — no files are uploaded.
      </p>

      {/* Drop Zone */}
      <div
        className={`drop-zone ${dragActive ? "drop-zone--active" : ""}`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".heic,.heif,image/heic,image/heif"
          multiple
          onChange={handleFileInput}
        />
        <p>
          <strong>Drop HEIC files here</strong>
          <br />
          or click to browse
        </p>
      </div>

      {/* Settings */}
      <div className="settings">
        <h2 style={{ marginBottom: "0.5em" }}>Settings</h2>

        <div className="setting-group">
          <label htmlFor="format">Output Format</label>
          <select
            id="format"
            value={format}
            onChange={(e) => setFormat(e.target.value as OutputFormat)}
          >
            <option value="image/jpeg">JPEG</option>
            <option value="image/png">PNG</option>
          </select>
        </div>

        {format === "image/jpeg" && (
          <div className="setting-group">
            <label htmlFor="quality">JPEG Quality</label>
            <select
              id="quality"
              value={qualityPreset}
              onChange={(e) => setQualityPreset(e.target.value as QualityPreset)}
            >
              <option value="low">Low (30%)</option>
              <option value="mid">Mid (60%)</option>
              <option value="high">High (92%)</option>
              <option value="custom">Custom</option>
            </select>
            {qualityPreset === "custom" && (
              <div className="quality-custom">
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={customQuality}
                  onChange={(e) => {
                    const v = Math.max(1, Math.min(100, Number(e.target.value)));
                    setCustomQuality(v);
                  }}
                  style={{ display: "inline-block", width: "5em" }}
                />
                <span style={{ marginLeft: "0.4em" }}>%</span>
              </div>
            )}
          </div>
        )}

        <div className="resize-section">
          <div className="setting-group">
            <label htmlFor="resizeMode">Resize</label>
            <select
              id="resizeMode"
              value={resizeMode}
              onChange={(e) => setResizeMode(e.target.value as ResizeMode)}
            >
              <option value="none">No resize</option>
              <option value="width">Max width</option>
              <option value="height">Max height</option>
            </select>
          </div>

          {resizeMode !== "none" && (
            <div className="setting-group">
              <label htmlFor="resizeValue">
                {resizeMode === "width" ? "Max Width (px)" : "Max Height (px)"}
              </label>
              <input
                id="resizeValue"
                type="number"
                min={1}
                value={resizeValue}
                onChange={(e) => setResizeValue(Math.max(1, Number(e.target.value)))}
              />
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="actions">
        <button
          className="btn btn--primary"
          disabled={pendingCount === 0 || converting}
          onClick={convertAll}
        >
          {converting ? "Converting…" : `Convert ${pendingCount} file${pendingCount !== 1 ? "s" : ""}`}
        </button>
        <button
          className="btn"
          disabled={doneCount === 0}
          onClick={downloadAll}
        >
          Download all ({doneCount})
        </button>
        <button
          className="btn"
          disabled={totalCount === 0}
          onClick={clearAll}
        >
          Clear
        </button>
      </div>

      {/* Progress */}
      {converting && (
        <div className="progress-bar">
          <div className="progress-bar__fill" style={{ width: `${progress}%` }} />
        </div>
      )}

      {/* File List */}
      {files.length > 0 && (
        <div className="file-list">
          {files.map((entry) => {
            const dimensionsLabel = getDimensionsLabel(entry);

            return (
              <div className="file-item" key={entry.id}>
                <div className="file-item__info">
                  <span className="file-item__name" title={entry.name}>
                    {entry.name}
                  </span>
                  <span className="file-item__size">
                    {formatBytes(entry.size)}
                    {dimensionsLabel ? ` · ${dimensionsLabel}` : ""}
                  </span>
                </div>
                <span
                  className={`file-item__status file-item__status--${entry.status}`}
                >
                  {entry.status === "pending" && "Pending"}
                  {entry.status === "converting" && "Converting…"}
                  {entry.status === "done" &&
                    `✓ Done${entry.resultBlob ? ` (${formatBytes(entry.resultBlob.size)})` : ""}`}
                  {entry.status === "error" && `✗ Error`}
                </span>
                <div className="file-item__actions">
                  {entry.status === "done" && (
                    <button className="btn" onClick={() => downloadSingle(entry)}>
                      Save
                    </button>
                  )}
                  {(entry.status === "done" || entry.status === "error") && (
                    <button
                      className="btn"
                      onClick={() => {
                        setFiles((prev) =>
                          prev.map((f) =>
                            f.id === entry.id
                              ? {
                                  ...f,
                                  status: "pending",
                                  resultBlob: undefined,
                                  resultName: undefined,
                                  resultDimensions: undefined,
                                  error: undefined,
                                }
                              : f
                          )
                        );
                      }}
                      title="Reset to pending"
                    >
                      Reset
                    </button>
                  )}
                  <button className="btn" onClick={() => removeFile(entry.id)}>
                    ✕
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Summary */}
      {files.length > 0 && (
        <div className="summary">
          {totalCount} file{totalCount !== 1 ? "s" : ""} · {doneCount} converted ·{" "}
          {pendingCount} pending
        </div>
      )}
    </div>
  );
}

export default App;
