"use client";

import { cn } from "@repo/ui";
import { useLocale, useTranslations } from "next-intl";
import { useRef, useState, useTransition } from "react";
import { DecodeError, compressImage, sizeParts } from "@/lib/image-compress";
import {
  deleteImageAction,
  linkColourImageAction,
  reorderImagesAction,
  updateImageAltAction,
} from "@/server/actions/catalog-images";

/*
 * Product photos in the editor: pick or take photos → compress in the browser
 * (≤ 2000 px, ≤ 1.5 MB, EXIF stripped) → upload with progress (2 at a time) to
 * /api/admin/products/[id]/images. Then reorder (drag on desktop, ↑/↓ on mobile),
 * set the cover, edit alt text, delete, and link a photo to each colour.
 */

export type EditorImage = {
  id: string;
  url: string;
  thumbUrl: string;
  altBn: string | null;
  altEn: string | null;
};

type ColourValue = { id: string; bn: string; en: string; hex?: string; imageId: string | null };

type Job = {
  id: string;
  name: string;
  source: File;
  status: "compressing" | "queued" | "uploading" | "done" | "error" | "cancelled";
  progress: number;
  before: number;
  after?: number;
  upload?: File;
  message?: string;
  xhr?: XMLHttpRequest;
};

const MAX_IMAGES = 10;
const PARALLEL = 2;

export function ProductImages({
  productId,
  initialImages,
  colours,
}: {
  productId: string;
  initialImages: EditorImage[];
  colours: ColourValue[];
}) {
  const t = useTranslations("catalog.images");
  const [images, setImagesState] = useState(initialImages);
  const [jobs, setJobsState] = useState<Job[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  // Source of truth for the upload queue; only written from event handlers and callbacks.
  const jobsRef = useRef<Job[]>([]);
  const imageCountRef = useRef(initialImages.length);
  const compressQueue = useRef<Promise<void>>(Promise.resolve());

  const setImages: React.Dispatch<React.SetStateAction<EditorImage[]>> = (next) =>
    setImagesState((prev) => {
      const value = typeof next === "function" ? next(prev) : next;
      imageCountRef.current = value.length;
      return value;
    });
  const commit = (next: Job[]) => {
    jobsRef.current = next;
    setJobsState(next);
  };
  const update = (id: string, patch: Partial<Job>) =>
    commit(jobsRef.current.map((j) => (j.id === id ? { ...j, ...patch } : j)));
  const active = (j: Job) => j.status === "compressing" || j.status === "queued" || j.status === "uploading";

  const size = (bytes: number) => {
    const p = sizeParts(bytes);
    return p.unit === "MB" ? t("mb", { value: p.value }) : t("kb", { value: p.value });
  };
  const remaining = Math.max(0, MAX_IMAGES - images.length - jobs.filter(active).length);

  /** Starts queued uploads while fewer than PARALLEL are running. */
  const pump = () => {
    let running = jobsRef.current.filter((j) => j.status === "uploading").length;
    for (const job of jobsRef.current) {
      if (running >= PARALLEL) break;
      if (job.status === "queued" && job.upload) {
        startUpload(job);
        running++;
      }
    }
  };

  const startUpload = (job: Job) => {
    if (!job.upload) return;
    const xhr = new XMLHttpRequest();
    const form = new FormData();
    form.set("file", job.upload);
    xhr.open("POST", `/api/admin/products/${productId}/images`);
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) update(job.id, { progress: Math.round((e.loaded / e.total) * 100) });
    };
    xhr.onload = () => {
      const body = xhr.response as { ok: boolean; image?: EditorImage; message?: string } | null;
      if (xhr.status === 201 && body?.ok && body.image) {
        setImages((all) => [...all, body.image!]);
        update(job.id, { status: "done", progress: 100, xhr: undefined });
      } else {
        update(job.id, { status: "error", message: body?.message ?? String(xhr.status), xhr: undefined });
      }
      pump();
    };
    xhr.onerror = () => {
      update(job.id, { status: "error", message: t("status.error"), xhr: undefined });
      pump();
    };
    xhr.onabort = () => {
      update(job.id, { status: "cancelled", xhr: undefined });
      pump();
    };
    update(job.id, { status: "uploading", progress: 0, xhr });
    xhr.send(form);
  };

  /** Compression runs one file at a time (CPU bound), in a worker when available. */
  const compress = async (job: Job) => {
    if (jobsRef.current.find((j) => j.id === job.id)?.status !== "compressing") return; // cancelled meanwhile
    try {
      const out = await compressImage(job.source);
      if (jobsRef.current.find((j) => j.id === job.id)?.status !== "compressing") return;
      update(job.id, { status: "queued", after: out.file.size, upload: out.file });
      pump();
    } catch (error) {
      update(job.id, {
        status: "error",
        message: error instanceof DecodeError ? t("undecodable") : String((error as Error).message),
      });
    }
  };
  const enqueueCompression = (job: Job) => {
    compressQueue.current = compressQueue.current.then(() => compress(job));
  };

  const addFiles = (files: FileList | null) => {
    if (!files?.length) return;
    setNotice(null);
    const room = MAX_IMAGES - imageCountRef.current - jobsRef.current.filter(active).length;
    const list = [...files];
    if (list.length > room) setNotice(t("overLimit", { max: MAX_IMAGES }));
    const added: Job[] = list.slice(0, Math.max(0, room)).map((file) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name: file.name,
      source: file,
      status: "compressing",
      progress: 0,
      before: file.size,
    }));
    commit([...jobsRef.current, ...added]);
    added.forEach(enqueueCompression);
  };

  const retry = (job: Job) => {
    if (job.upload) {
      update(job.id, { status: "queued", message: undefined, progress: 0 });
      pump();
    } else {
      update(job.id, { status: "compressing", message: undefined });
      enqueueCompression(job);
    }
  };
  const cancel = (job: Job) => {
    if (job.xhr) job.xhr.abort();
    else update(job.id, { status: "cancelled" });
  };
  const dismiss = (job: Job) => commit(jobsRef.current.filter((j) => j.id !== job.id));

  return (
    <section className="flex flex-col gap-4" data-product-images>
      <p className="text-sm text-neutral-500">{t("hint", { max: MAX_IMAGES })}</p>

      <ImageList productId={productId} images={images} setImages={setImages} />

      <div className="flex flex-wrap items-center gap-2">
        <FilePick label={t("choose")} disabled={remaining === 0} onFiles={addFiles} multiple testId="pick" />
        <FilePick
          label={t("takePhoto")}
          disabled={remaining === 0}
          onFiles={addFiles}
          capture
          testId="camera"
        />
        <span className="text-sm text-neutral-500" data-remaining={remaining}>
          {t("remaining", { count: remaining })}
        </span>
      </div>
      {notice ? (
        <p role="alert" className="text-sm text-amber-700 dark:text-amber-300">
          {notice}
        </p>
      ) : null}

      {jobs.length > 0 ? (
        <ul className="flex flex-col gap-2" data-upload-jobs>
          {jobs.map((job) => (
            <li
              key={job.id}
              data-job-status={job.status}
              className="flex flex-col gap-1 rounded-lg border border-neutral-200 p-3 text-sm dark:border-neutral-800"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 truncate font-medium">{job.name}</span>
                <span className="text-neutral-500" data-sizes>
                  {t("sizes", {
                    before: size(job.before),
                    after: job.after !== undefined ? size(job.after) : "…",
                  })}
                </span>
              </div>
              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={job.progress}
                className="h-2 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800"
              >
                <div
                  className={cn(
                    "h-full transition-all",
                    job.status === "error" ? "bg-red-500" : "bg-[var(--brand)]",
                  )}
                  style={{ width: `${job.status === "done" ? 100 : job.progress}%` }}
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span
                  className={cn(job.status === "error" && "text-red-600 dark:text-red-400")}
                  data-job-message
                >
                  {job.status === "error"
                    ? job.message
                    : job.status === "uploading"
                      ? t("status.uploading", { percent: job.progress })
                      : t(`status.${job.status}`)}
                </span>
                <span className="flex gap-2">
                  {job.status === "error" && job.message !== t("undecodable") ? (
                    <SmallButton onClick={() => retry(job)}>{t("retry")}</SmallButton>
                  ) : null}
                  {["compressing", "queued", "uploading"].includes(job.status) ? (
                    <SmallButton onClick={() => cancel(job)}>{t("cancel")}</SmallButton>
                  ) : (
                    <SmallButton onClick={() => dismiss(job)}>{t("dismiss")}</SmallButton>
                  )}
                </span>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {colours.length > 0 ? <ColourLinks productId={productId} colours={colours} images={images} /> : null}
    </section>
  );
}

function FilePick({
  label,
  disabled,
  onFiles,
  multiple,
  capture,
  testId,
}: {
  label: string;
  disabled: boolean;
  onFiles: (files: FileList | null) => void;
  multiple?: boolean;
  capture?: boolean;
  testId: string;
}) {
  return (
    <label
      className={cn(
        "inline-flex min-h-11 cursor-pointer items-center justify-center rounded-md border border-neutral-300 px-4 text-sm font-medium dark:border-neutral-700",
        disabled && "pointer-events-none opacity-50",
      )}
    >
      {label}
      <input
        type="file"
        accept="image/*"
        multiple={multiple}
        {...(capture ? { capture: "environment" as const } : {})}
        disabled={disabled}
        className="sr-only"
        data-file-input={testId}
        onChange={(e) => {
          onFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </label>
  );
}

function SmallButton({
  children,
  onClick,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "min-h-11 min-w-11 rounded-md border px-3 text-sm",
        danger
          ? "border-red-300 text-red-700 dark:border-red-800 dark:text-red-300"
          : "border-neutral-300 dark:border-neutral-700",
      )}
    >
      {children}
    </button>
  );
}

function ImageList({
  productId,
  images,
  setImages,
}: {
  productId: string;
  images: EditorImage[];
  setImages: React.Dispatch<React.SetStateAction<EditorImage[]>>;
}) {
  const t = useTranslations("catalog.images");
  const [, startTransition] = useTransition();
  const [dragging, setDragging] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const persist = (next: EditorImage[]) => {
    setImages(next);
    startTransition(async () => {
      const r = await reorderImagesAction(
        productId,
        next.map((i) => i.id),
      );
      if (!r.ok) setError(r.message);
    });
  };
  const move = (from: number, to: number) => {
    if (to < 0 || to >= images.length || from === to) return;
    const next = [...images];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    persist(next);
  };

  if (images.length === 0) return <p className="text-sm text-neutral-500">{t("empty")}</p>;
  return (
    <>
      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}
      <ol className="grid grid-cols-1 gap-3 sm:grid-cols-2" data-image-list>
        {images.map((img, i) => (
          <li
            key={img.id}
            draggable
            onDragStart={() => setDragging(img.id)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              const from = images.findIndex((x) => x.id === dragging);
              if (from >= 0) move(from, i);
              setDragging(null);
            }}
            data-image-id={img.id}
            className={cn(
              "flex flex-col gap-2 rounded-lg border border-neutral-200 p-2 dark:border-neutral-800",
              dragging === img.id && "opacity-50",
            )}
            title={t("dragHint")}
          >
            <div className="flex gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element -- 400 px thumb */}
              <img src={img.thumbUrl} alt="" className="size-20 shrink-0 rounded object-cover sm:size-24" />
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  {i === 0 ? (
                    <span
                      className="rounded bg-[var(--brand)] px-2 py-0.5 text-xs font-medium text-white"
                      data-cover
                    >
                      {t("cover")}
                    </span>
                  ) : (
                    <SmallButton onClick={() => move(i, 0)}>{t("makeCover")}</SmallButton>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <SmallButton onClick={() => move(i, i - 1)}>
                    <span aria-hidden>↑</span>
                    <span className="sr-only">{t("moveUp")}</span>
                  </SmallButton>
                  <SmallButton onClick={() => move(i, i + 1)}>
                    <span aria-hidden>↓</span>
                    <span className="sr-only">{t("moveDown")}</span>
                  </SmallButton>
                  {confirming === img.id ? (
                    <>
                      <SmallButton
                        danger
                        onClick={() =>
                          startTransition(async () => {
                            const r = await deleteImageAction(img.id);
                            if (r.ok) setImages((all) => all.filter((x) => x.id !== img.id));
                            else setError(r.message);
                            setConfirming(null);
                          })
                        }
                      >
                        {t("yesDelete")}
                      </SmallButton>
                      <SmallButton onClick={() => setConfirming(null)}>{t("keep")}</SmallButton>
                    </>
                  ) : (
                    <SmallButton danger onClick={() => setConfirming(img.id)}>
                      {t("delete")}
                    </SmallButton>
                  )}
                </div>
              </div>
            </div>
            <AltFields
              image={img}
              onSaved={(alt) => setImages((all) => all.map((x) => (x.id === img.id ? { ...x, ...alt } : x)))}
            />
          </li>
        ))}
      </ol>
    </>
  );
}

function AltFields({
  image,
  onSaved,
}: {
  image: EditorImage;
  onSaved: (alt: { altBn: string; altEn: string }) => void;
}) {
  const t = useTranslations("catalog.images");
  const [bn, setBn] = useState(image.altBn ?? "");
  const [en, setEn] = useState(image.altEn ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const save = async () => {
    if (bn === (image.altBn ?? "") && en === (image.altEn ?? "")) return;
    const r = await updateImageAltAction(image.id, bn, en);
    if (r.ok) {
      setMessage(null);
      onSaved({ altBn: bn, altEn: en });
    } else setMessage(r.message);
  };
  const input =
    "h-11 w-full rounded-md border border-neutral-300 bg-white px-3 text-base sm:text-sm dark:border-neutral-700 dark:bg-neutral-900";
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <label className="flex flex-col gap-1 text-xs text-neutral-500">
        {t("altBn")}
        <input
          className={input}
          lang="bn"
          value={bn}
          maxLength={200}
          onChange={(e) => setBn(e.target.value)}
          onBlur={save}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-neutral-500">
        {t("altEn")}
        <input
          className={input}
          lang="en"
          value={en}
          maxLength={200}
          onChange={(e) => setEn(e.target.value)}
          onBlur={save}
        />
      </label>
      {message ? <p className="text-xs text-red-600 sm:col-span-2">{message}</p> : null}
    </div>
  );
}

function ColourLinks({
  productId,
  colours,
  images,
}: {
  productId: string;
  colours: ColourValue[];
  images: EditorImage[];
}) {
  const t = useTranslations("catalog.images");
  const locale = useLocale() as "bn" | "en";
  const [links, setLinks] = useState(() => Object.fromEntries(colours.map((c) => [c.id, c.imageId])));
  const [error, setError] = useState<string | null>(null);
  return (
    <fieldset className="flex flex-col gap-2" data-colour-links>
      <legend className="font-medium">{t("colourPhotos")}</legend>
      <p className="text-xs text-neutral-500">{t("colourPhotosHint")}</p>
      {colours.map((c) => (
        <label key={c.id} className="flex flex-wrap items-center gap-3 text-sm">
          <span className="flex min-w-24 items-center gap-2">
            <span
              className="size-5 rounded-full border"
              style={{ background: c.hex ?? "transparent" }}
              aria-hidden
            />
            {c[locale]}
          </span>
          <select
            value={links[c.id] ?? ""}
            data-colour={c.id}
            onChange={async (e) => {
              const imageId = e.target.value || null;
              setLinks((l) => ({ ...l, [c.id]: imageId }));
              const r = await linkColourImageAction(productId, c.id, imageId);
              setError(r.ok ? null : r.message);
            }}
            className="h-11 min-w-40 rounded-md border border-neutral-300 bg-white px-3 text-base sm:text-sm dark:border-neutral-700 dark:bg-neutral-900"
          >
            <option value="">{t("noLink")}</option>
            {images.map((img, i) => (
              <option key={img.id} value={img.id}>
                {t("photoN", { n: i + 1 })}
              </option>
            ))}
          </select>
        </label>
      ))}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </fieldset>
  );
}
