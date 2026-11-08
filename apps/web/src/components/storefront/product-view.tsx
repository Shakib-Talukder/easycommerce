"use client";

import type { OptionAxis, OptionValues } from "@repo/core/catalog-client";
import { formatBDT } from "@repo/db/money";
import { cn } from "@repo/ui";
import { useTranslations } from "next-intl";
import { useMemo, useRef, useState } from "react";

type Image = { id: string; url: string; thumbUrl: string; width: number; height: number; alt: string };
type Variant = {
  id: string;
  optionValues: OptionValues;
  price: number;
  salePrice: number | null;
  stock: number;
  imageId: string | null;
};

/*
 * Product page body: a swipeable gallery (scroll-snap, thumbnails, arrows) and the
 * variant picker. Combinations without a live variant are disabled; out-of-stock
 * ones are shown but marked. Picking a colour shows the photo linked to it.
 */
export function ProductView({
  title,
  description,
  lang,
  axes,
  variants,
  images,
}: {
  title: string;
  description: string | null;
  lang: "bn" | "en";
  axes: OptionAxis[];
  variants: Variant[];
  images: Image[];
}) {
  const t = useTranslations("storefront");
  const [selected, setSelected] = useState<OptionValues>(() => {
    // Start with the first in-stock variant (or the first one).
    const first = variants.find((v) => v.stock > 0) ?? variants[0];
    return first ? { ...first.optionValues } : {};
  });
  const [current, setCurrent] = useState(0);
  const track = useRef<HTMLDivElement>(null);

  const match = (values: OptionValues) =>
    variants.find((v) => axes.every((a) => v.optionValues[a.key] === values[a.key]));
  const variant = axes.length === 0 ? variants[0] : match(selected);
  const missing = axes.filter((a) => !selected[a.key]);

  const showImage = (index: number) => {
    setCurrent(index);
    const el = track.current?.children[index] as HTMLElement | undefined;
    track.current?.scrollTo({ left: el?.offsetLeft ?? 0, behavior: "smooth" });
  };
  const pick = (key: "size" | "colour", id: string) => {
    const next = { ...selected, [key]: id };
    setSelected(next);
    if (key === "colour") {
      // The colour's linked photo: from the matching variant, else any variant with that colour.
      const linked =
        match(next)?.imageId ?? variants.find((v) => v.optionValues.colour === id && v.imageId)?.imageId;
      const index = images.findIndex((img) => img.id === linked);
      if (index >= 0) showImage(index);
    }
  };

  /** State of one option value given the other selected options. */
  const valueState = useMemo(
    () => (key: "size" | "colour", id: string) => {
      const candidate = { ...selected, [key]: id };
      const others = axes.filter((a) => a.key !== key);
      const fits = variants.filter(
        (v) =>
          v.optionValues[key] === id &&
          others.every((a) => !candidate[a.key] || v.optionValues[a.key] === candidate[a.key]),
      );
      if (fits.length === 0) return "unavailable" as const;
      return fits.some((v) => v.stock > 0) ? ("ok" as const) : ("out" as const);
    },
    [axes, selected, variants],
  );

  const price = variant ? (variant.salePrice ?? variant.price) : null;
  const regular = variant && variant.salePrice !== null ? variant.price : null;

  return (
    <div className="grid gap-6 md:grid-cols-2 md:gap-10">
      {/* Gallery */}
      <div className="flex min-w-0 flex-col gap-3" data-gallery>
        <div className="relative">
          <div
            ref={track}
            className="flex snap-x snap-mandatory overflow-x-auto rounded-xl [scrollbar-width:none]"
            onScroll={(e) => {
              const el = e.currentTarget;
              setCurrent(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
            }}
          >
            {images.map((img, i) => (
              // eslint-disable-next-line @next/next/no-img-element -- immutable WebP; thumb or full size by srcset
              <img
                key={img.id}
                src={img.url}
                srcSet={`${img.thumbUrl} 400w, ${img.url} ${img.width}w`}
                sizes="(min-width: 768px) 50vw, 100vw"
                width={img.width}
                height={img.height}
                alt={img.alt || title}
                loading={i === 0 ? "eager" : "lazy"}
                data-image-id={img.id}
                className="aspect-square w-full shrink-0 snap-center bg-neutral-100 object-contain dark:bg-neutral-800"
              />
            ))}
          </div>
          {images.length > 1 ? (
            <>
              <button
                type="button"
                onClick={() => showImage(Math.max(0, current - 1))}
                aria-label={t("prevPhoto")}
                className="absolute top-1/2 left-2 hidden size-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 shadow md:flex dark:bg-neutral-900/90"
              >
                ‹
              </button>
              <button
                type="button"
                onClick={() => showImage(Math.min(images.length - 1, current + 1))}
                aria-label={t("nextPhoto")}
                className="absolute top-1/2 right-2 hidden size-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 shadow md:flex dark:bg-neutral-900/90"
              >
                ›
              </button>
            </>
          ) : null}
        </div>
        {images.length > 1 ? (
          <ul className="flex gap-2 overflow-x-auto pb-1" data-thumbnails>
            {images.map((img, i) => (
              <li key={img.id} className="shrink-0">
                <button
                  type="button"
                  onClick={() => showImage(i)}
                  aria-label={t("photo", { n: i + 1, total: images.length })}
                  aria-current={i === current ? "true" : undefined}
                  className={cn(
                    "block size-16 overflow-hidden rounded-md border-2",
                    i === current ? "border-[var(--brand)]" : "border-transparent",
                  )}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- 400 px thumb */}
                  <img src={img.thumbUrl} alt="" className="size-full object-cover" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <p className="sr-only" aria-live="polite" data-current-image={images[current]?.id}>
          {images.length ? t("photo", { n: current + 1, total: images.length }) : null}
        </p>
      </div>

      {/* Details */}
      <div className="flex min-w-0 flex-col gap-4">
        <h1 className="text-2xl font-bold break-words sm:text-3xl">{title}</h1>
        <div className="flex flex-wrap items-baseline gap-x-3" data-price>
          {price !== null ? (
            <span
              className={cn(
                "text-2xl font-semibold",
                regular !== null ? "text-red-600" : "text-[var(--brand)]",
              )}
              data-price-amount
            >
              {formatBDT(price, lang)}
            </span>
          ) : null}
          {regular !== null ? (
            <s
              className="text-lg text-neutral-400"
              aria-label={t("regularPrice", { price: formatBDT(regular, lang) })}
              data-regular-price
            >
              {formatBDT(regular, lang)}
            </s>
          ) : null}
          {variant && variant.stock <= 0 ? (
            <span className="text-sm font-medium text-red-600" data-out-of-stock>
              {t("outOfStock")}
            </span>
          ) : variant ? (
            <span className="text-sm text-neutral-500" data-stock={variant.stock}>
              {t("inStock", { count: variant.stock })}
            </span>
          ) : null}
        </div>

        {axes.map((axis) => (
          <fieldset key={axis.key} className="flex flex-col gap-2" data-axis={axis.key}>
            <legend className="mb-1 text-sm font-medium">
              {t(axis.key)}
              {selected[axis.key] ? (
                <span className="font-normal text-neutral-500">
                  {": "}
                  {axis.values.find((v) => v.id === selected[axis.key])?.[lang]}
                </span>
              ) : null}
            </legend>
            <div className="flex flex-wrap gap-2">
              {axis.values.map((v) => {
                const state = valueState(axis.key, v.id);
                const active = selected[axis.key] === v.id;
                return (
                  <button
                    key={v.id}
                    type="button"
                    disabled={state === "unavailable"}
                    onClick={() => pick(axis.key, v.id)}
                    aria-pressed={active}
                    data-value={v.id}
                    data-state={state}
                    title={
                      state === "unavailable"
                        ? t("unavailable")
                        : state === "out"
                          ? t("outOfStock")
                          : undefined
                    }
                    className={cn(
                      "relative flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-full border-2 px-3 text-sm",
                      active ? "border-[var(--brand)]" : "border-neutral-300 dark:border-neutral-700",
                      state === "out" && "text-neutral-400 line-through",
                      state === "unavailable" && "cursor-not-allowed opacity-30",
                    )}
                  >
                    {axis.key === "colour" ? (
                      <span
                        className="size-6 rounded-full border border-black/10"
                        style={{ background: v.hex ?? "transparent" }}
                        aria-hidden
                      />
                    ) : null}
                    <span>{v[lang]}</span>
                  </button>
                );
              })}
            </div>
          </fieldset>
        ))}
        {missing.length > 0 && axes.length > 0 ? (
          <p className="text-sm text-neutral-500">
            {t("chooseOptions", { options: missing.map((a) => t(a.key)).join(" / ") })}
          </p>
        ) : null}

        <button
          type="button"
          disabled
          className="min-h-12 rounded-md bg-[var(--brand)] px-6 text-base font-medium text-white opacity-60"
          data-order-button
        >
          {t("orderSoon")}
        </button>

        {description ? (
          <p className="whitespace-pre-line text-neutral-700 dark:text-neutral-300" data-description>
            {description}
          </p>
        ) : null}
      </div>
    </div>
  );
}
