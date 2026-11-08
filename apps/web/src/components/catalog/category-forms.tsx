"use client";

import { cn } from "@repo/ui";
import { useLocale, useTranslations } from "next-intl";
import { useActionState, useRef, useState, useTransition } from "react";
import { DecodeError, compressImage } from "@/lib/image-compress";
import {
  deleteCategoryAction,
  saveCategoryAction,
  uploadCategoryImageAction,
} from "@/server/actions/catalog";
import { Field, FormMessage, SubmitButton, fieldErrorsOf } from "../form-bits";

export type CategoryFormValues = {
  id?: string;
  nameBn: string;
  nameEn: string;
  descriptionBn: string;
  descriptionEn: string;
  parentId: string;
  isActive: boolean;
  slug?: string;
};

const select =
  "h-11 w-full rounded-md border border-neutral-300 bg-white px-3 text-base sm:text-sm dark:border-neutral-700 dark:bg-neutral-900";

/** Add or edit a category (names, description, parent, visibility, slug). */
export function CategoryForm({
  values,
  parents,
}: {
  values: CategoryFormValues;
  parents: { id: string; nameBn: string; nameEn: string }[];
}) {
  const t = useTranslations("catalog.categories");
  const locale = useLocale() as "bn" | "en";
  const [state, action] = useActionState(saveCategoryAction, null);
  const formRef = useRef<HTMLFormElement>(null);
  return (
    <form
      ref={formRef}
      action={async (fd) => {
        await action(fd);
        if (!values.id) formRef.current?.reset();
      }}
      className="flex flex-col gap-3"
      noValidate
      data-category-form={values.id ?? "new"}
    >
      {values.id ? <input type="hidden" name="categoryId" value={values.id} /> : null}
      <FormMessage state={state} />
      <div className="grid gap-3 md:grid-cols-2">
        <Field name="nameBn" label={t("nameBn")} state={state} defaultValue={values.nameBn} lang="bn" />
        <Field name="nameEn" label={t("nameEn")} state={state} defaultValue={values.nameEn} lang="en" />
        <Field
          name="descriptionBn"
          label={t("descriptionBn")}
          state={state}
          defaultValue={values.descriptionBn}
          optional
        />
        <Field
          name="descriptionEn"
          label={t("descriptionEn")}
          state={state}
          defaultValue={values.descriptionEn}
          optional
        />
        <label className="flex flex-col gap-2 text-sm font-medium">
          {t("parent")}
          <select
            name="parentId"
            defaultValue={values.parentId}
            className={cn(select, fieldErrorsOf(state, "parentId") && "border-red-500")}
          >
            <option value="">{t("topLevel")}</option>
            {parents
              .filter((p) => p.id !== values.id)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {locale === "en" ? p.nameEn : p.nameBn}
                </option>
              ))}
          </select>
          {fieldErrorsOf(state, "parentId") ? (
            <span className="text-xs text-red-600">{fieldErrorsOf(state, "parentId")![0]}</span>
          ) : null}
        </label>
        {values.id ? <Field name="slug" label={t("slug")} state={state} defaultValue={values.slug} /> : null}
      </div>
      <label className="flex min-h-11 items-center gap-3 text-sm">
        <input type="hidden" name="isActive" value="false" />
        <input
          type="checkbox"
          name="isActive"
          value="on"
          defaultChecked={values.isActive}
          className="size-5"
        />
        {t("active")}
      </label>
      <SubmitButton className="sm:w-fit">{values.id ? t("save") : t("add")}</SubmitButton>
    </form>
  );
}

/** Delete with a confirmation showing how many products the category has. */
export function DeleteCategory({ id, productCount }: { id: string; productCount: number }) {
  const t = useTranslations("catalog.categories");
  const [state, action] = useActionState(deleteCategoryAction, null);
  const [asking, setAsking] = useState(false);
  const btn = "inline-flex min-h-11 items-center justify-center rounded-md px-4 text-sm font-medium";
  return (
    <form action={action} className="flex flex-wrap items-center gap-2" data-delete-category={id}>
      <input type="hidden" name="categoryId" value={id} />
      <input type="hidden" name="confirm" value="1" />
      {state && !state.ok ? <FormMessage state={state} /> : null}
      {asking ? (
        <>
          <span role="alert" className="text-sm">
            {t("deleteConfirm", { count: productCount })}
          </span>
          <button type="submit" className={cn(btn, "bg-red-600 text-white")} data-confirm-yes>
            {t("yesDelete")}
          </button>
          <button
            type="button"
            className={cn(btn, "border border-neutral-300 dark:border-neutral-700")}
            onClick={() => setAsking(false)}
          >
            {t("keep")}
          </button>
        </>
      ) : (
        <button
          type="button"
          className={cn(btn, "border border-red-300 text-red-700 dark:border-red-800 dark:text-red-300")}
          onClick={() => setAsking(true)}
        >
          {t("delete")}
        </button>
      )}
    </form>
  );
}

/** Category image: compressed in the browser, then processed like product photos (800 px). */
export function CategoryImage({ id, url }: { id: string; url: string | null }) {
  const t = useTranslations("catalog.categories");
  const ti = useTranslations("catalog.images");
  const [current, setCurrent] = useState(url);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex flex-wrap items-center gap-3" data-category-image={id}>
      {current ? (
        // eslint-disable-next-line @next/next/no-img-element -- 800 px category image
        <img src={current} alt="" className="size-16 rounded object-cover" />
      ) : (
        <span className="size-16 rounded bg-neutral-100 dark:bg-neutral-800" aria-hidden />
      )}
      <label
        className={cn(
          "inline-flex min-h-11 cursor-pointer items-center rounded-md border border-neutral-300 px-4 text-sm dark:border-neutral-700",
          pending && "opacity-50",
        )}
      >
        {pending ? t("uploading") : t("uploadImage")}
        <input
          type="file"
          accept="image/*"
          className="sr-only"
          disabled={pending}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            startTransition(async () => {
              try {
                const out = await compressImage(file);
                const fd = new FormData();
                fd.set("categoryId", id);
                fd.set("image", out.file);
                const r = await uploadCategoryImageAction(null, fd);
                if (r?.ok) {
                  setCurrent(String(r.data?.url));
                  setMessage(null);
                } else setMessage(r?.message ?? null);
              } catch (error) {
                setMessage(
                  error instanceof DecodeError ? ti("undecodable") : String((error as Error).message),
                );
              }
            });
          }}
        />
      </label>
      {message ? <p className="w-full text-sm text-red-600">{message}</p> : null}
    </div>
  );
}
