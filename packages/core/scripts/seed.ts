/**
 * Idempotent demo data: two stores with settings, owners/staff, a bilingual
 * catalogue (categories incl. a child, products with size × colour variants,
 * simple products, sale prices, featured, out of stock, a draft) with generated
 * placeholder photos stored through the real image pipeline, a customer and an
 * order. Uses the BYPASSRLS admin role because it writes across tenants.
 *
 *   pnpm db:seed          (prisma db seed runs this file)
 *
 * Re-running deletes each seeded store's objects and rows first.
 */
import path from "node:path";
import { config as loadEnv } from "dotenv";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
loadEnv({ path: path.join(repoRoot, ".env"), quiet: true });
// Same default as the web app (which runs with cwd apps/web).
process.env.LOCAL_UPLOAD_DIR ||= path.join(repoRoot, "apps/web/public/uploads");

const { adminClient } = await import("@repo/db/admin");
const { disconnectAll } = await import("@repo/db");
const { default: sharp } = await import("sharp");
const { getStorageProvider } = await import("../src/storage");
const { processAndStoreImage } = await import("../src/images");

const db = adminClient();
const storage = getStorageProvider();

type Value = { id: string; bn: string; en: string; hex?: string };
type Axis = { key: "size" | "colour"; values: Value[] };
type SeedVariant = { size?: string; colour?: string; price: number; salePrice?: number; stock: number };

type SeedProduct = {
  slug: string;
  titleBn: string;
  titleEn: string;
  descriptionBn: string;
  descriptionEn: string;
  category?: string;
  status?: "ACTIVE" | "DRAFT" | "ARCHIVED";
  featured?: number;
  options?: Axis[];
  variants: SeedVariant[];
  /** Placeholder photo colour(s): one per colour value (linked to its variants), else one. */
  photo: string;
};

type SeedUser = { name: string; email?: string; phone?: string; locale?: "bn" | "en" };

type SeedCategory = { slug: string; nameBn: string; nameEn: string; parent?: string; photo?: string };

type SeedStore = {
  nameBn: string;
  nameEn: string;
  subdomain: string;
  language: "bn" | "en";
  owner: SeedUser;
  staff?: SeedUser[];
  categories: SeedCategory[];
  products: SeedProduct[];
};

const sizes = (...ids: string[]): Axis => ({
  key: "size",
  values: ids.map((id) => ({ id: id.toLowerCase(), bn: id, en: id })),
});
const colours = (...v: Value[]): Axis => ({ key: "colour", values: v });
const WHITE = { id: "white", bn: "সাদা", en: "White", hex: "#f5f5f4" };
const BLUE = { id: "blue", bn: "নীল", en: "Blue", hex: "#1d4ed8" };
const MAROON = { id: "maroon", bn: "মেরুন", en: "Maroon", hex: "#7f1d1d" };
const BLACK = { id: "black", bn: "কালো", en: "Black", hex: "#111827" };
const RED = { id: "red", bn: "লাল", en: "Red", hex: "#dc2626" };
const GREEN = { id: "green", bn: "সবুজ", en: "Green", hex: "#15803d" };

/** Every size × colour combination with one price/stock rule. */
function matrix(
  axes: Axis[],
  rule: (size?: string, colour?: string) => Omit<SeedVariant, "size" | "colour">,
) {
  const sizeIds = axes.find((a) => a.key === "size")?.values.map((v) => v.id) ?? [undefined];
  const colourIds = axes.find((a) => a.key === "colour")?.values.map((v) => v.id) ?? [undefined];
  return sizeIds.flatMap((size) => colourIds.map((colour) => ({ size, colour, ...rule(size, colour) })));
}

const stores: SeedStore[] = [
  {
    nameBn: "ঢাকা ফ্যাশন হাউস",
    nameEn: "Dhaka Fashion House",
    subdomain: "dhaka-fashion",
    language: "bn",
    owner: { name: "রহিম উদ্দিন", email: "owner@dhaka-fashion.test", phone: "+8801711000001" },
    staff: [{ name: "সালমা বেগম", phone: "+8801711000005" }],
    categories: [
      { slug: "clothing", nameBn: "পোশাক", nameEn: "Clothing", photo: "#0f766e" },
      { slug: "panjabi", nameBn: "পাঞ্জাবি", nameEn: "Panjabi", parent: "clothing", photo: "#1d4ed8" },
      { slug: "saree", nameBn: "শাড়ি", nameEn: "Saree", photo: "#be123c" },
    ],
    products: [
      {
        slug: "cotton-panjabi",
        titleBn: "সুতির পাঞ্জাবি",
        titleEn: "Cotton Panjabi",
        descriptionBn: "ঈদের জন্য আরামদায়ক সুতির পাঞ্জাবি।\nনরম কাপড়, সারাদিন পরার মতো।",
        descriptionEn: "A comfortable cotton panjabi for Eid.\nSoft fabric you can wear all day.",
        category: "panjabi",
        featured: 0,
        options: [sizes("M", "L", "XL"), colours(WHITE, BLUE)],
        variants: matrix([sizes("M", "L", "XL"), colours(WHITE, BLUE)], (size) => ({
          price: size === "xl" ? 195000 : 185000,
          salePrice: size === "m" ? 165000 : undefined,
          stock: size === "xl" ? 3 : 20,
        })),
        photo: "colours",
      },
      {
        slug: "silk-panjabi",
        titleBn: "সিল্ক পাঞ্জাবি",
        titleEn: "Silk Panjabi",
        descriptionBn: "বিয়ে ও উৎসবের জন্য সিল্ক পাঞ্জাবি।",
        descriptionEn: "A silk panjabi for weddings and festivals.",
        category: "panjabi",
        featured: 1,
        options: [sizes("S", "M", "L"), colours(MAROON, BLACK)],
        variants: matrix([sizes("S", "M", "L"), colours(MAROON, BLACK)], () => ({ price: 350000, stock: 8 })),
        photo: "colours",
      },
      {
        slug: "kids-panjabi",
        titleBn: "বাচ্চাদের পাঞ্জাবি",
        titleEn: "Kids' Panjabi",
        descriptionBn: "২ থেকে ৭ বছরের বাচ্চাদের জন্য।",
        descriptionEn: "For children aged 2 to 7.",
        category: "panjabi",
        options: [
          {
            key: "size",
            values: [
              { id: "2-3y", bn: "২–৩ বছর", en: "2–3 yrs" },
              { id: "4-5y", bn: "৪–৫ বছর", en: "4–5 yrs" },
              { id: "6-7y", bn: "৬–৭ বছর", en: "6–7 yrs" },
            ],
          },
        ],
        variants: [
          { size: "2-3y", price: 90000, stock: 12 },
          { size: "4-5y", price: 95000, stock: 10 },
          { size: "6-7y", price: 100000, stock: 0 },
        ],
        photo: "#0369a1",
      },
      {
        slug: "jamdani-saree",
        titleBn: "জামদানি শাড়ি",
        titleEn: "Jamdani Saree",
        descriptionBn: "হাতে বোনা ঐতিহ্যবাহী জামদানি।",
        descriptionEn: "Traditional hand-woven jamdani.",
        category: "saree",
        featured: 2,
        variants: [{ price: 1250000, salePrice: 1100000, stock: 4 }],
        photo: "#9d174d",
      },
      {
        slug: "katan-saree",
        titleBn: "কাতান শাড়ি",
        titleEn: "Katan Saree",
        descriptionBn: "বেনারসি কাতান। আবার আসছে শীঘ্রই।",
        descriptionEn: "Benarasi katan. Back in stock soon.",
        category: "saree",
        variants: [{ price: 980000, stock: 0 }],
        photo: "#7c2d12",
      },
      {
        slug: "nakshi-shawl",
        titleBn: "নকশি শাল",
        titleEn: "Nakshi Shawl",
        descriptionBn: "হাতের কাজের নকশি শাল।",
        descriptionEn: "A hand-embroidered nakshi shawl.",
        category: "clothing",
        options: [colours(RED, GREEN)],
        variants: [
          { colour: "red", price: 240000, stock: 6 },
          { colour: "green", price: 240000, salePrice: 199000, stock: 5 },
        ],
        photo: "colours",
      },
      {
        slug: "cotton-lungi",
        titleBn: "সুতির লুঙ্গি",
        titleEn: "Cotton Lungi",
        descriptionBn: "আরামদায়ক চেক লুঙ্গি।",
        descriptionEn: "A comfortable checked lungi.",
        category: "clothing",
        variants: [{ price: 45000, stock: 40 }],
        photo: "#4d7c0f",
      },
      {
        slug: "leather-sandal",
        titleBn: "চামড়ার স্যান্ডেল",
        titleEn: "Leather Sandal",
        descriptionBn: "খসড়া: ছবি ও দাম ঠিক করা বাকি।",
        descriptionEn: "Draft: photos and prices still to come.",
        status: "DRAFT",
        options: [sizes("40", "41", "42")],
        variants: matrix([sizes("40", "41", "42")], () => ({ price: 150000, stock: 5 })),
        photo: "#78350f",
      },
    ],
  },
  {
    nameBn: "রাজশাহী ম্যাঙ্গো কোং",
    nameEn: "Rajshahi Mango Co.",
    subdomain: "rajshahi-mango",
    language: "en",
    owner: { name: "Karim Ahmed", phone: "+8801811000002", locale: "en" },
    categories: [
      { slug: "mangoes", nameBn: "আম", nameEn: "Mangoes", photo: "#ca8a04" },
      { slug: "pickles", nameBn: "আচার", nameEn: "Pickles", parent: "mangoes", photo: "#b45309" },
    ],
    products: [
      {
        slug: "himsagar-mango",
        titleBn: "হিমসাগর আম",
        titleEn: "Himsagar Mango",
        descriptionBn: "রাজশাহীর তাজা হিমসাগর।",
        descriptionEn: "Fresh Himsagar from Rajshahi, shipped in a crate.",
        category: "mangoes",
        featured: 0,
        options: [
          {
            key: "size",
            values: [
              { id: "5kg", bn: "৫ কেজি", en: "5 kg" },
              { id: "10kg", bn: "১০ কেজি", en: "10 kg" },
            ],
          },
        ],
        variants: [
          { size: "5kg", price: 120000, stock: 100 },
          { size: "10kg", price: 230000, stock: 40 },
        ],
        photo: "#eab308",
      },
      {
        slug: "langra-mango",
        titleBn: "ল্যাংড়া আম",
        titleEn: "Langra Mango",
        descriptionBn: "মিষ্টি ল্যাংড়া আম।",
        descriptionEn: "Sweet Langra mangoes.",
        category: "mangoes",
        featured: 1,
        options: [
          {
            key: "size",
            values: [
              { id: "5kg", bn: "৫ কেজি", en: "5 kg" },
              { id: "10kg", bn: "১০ কেজি", en: "10 kg" },
            ],
          },
        ],
        variants: [
          { size: "5kg", price: 110000, salePrice: 95000, stock: 60 },
          { size: "10kg", price: 210000, stock: 25 },
        ],
        photo: "#65a30d",
      },
      {
        slug: "fazli-mango",
        titleBn: "ফজলি আম",
        titleEn: "Fazli Mango (10 kg)",
        descriptionBn: "বড় আকারের ফজলি আম।",
        descriptionEn: "Large Fazli mangoes, 10 kg crate.",
        category: "mangoes",
        variants: [{ price: 180000, stock: 30 }],
        photo: "#84cc16",
      },
      {
        slug: "mango-pickle",
        titleBn: "আমের আচার",
        titleEn: "Mango Pickle (400 g)",
        descriptionBn: "ঘরে বানানো টক-মিষ্টি আচার।",
        descriptionEn: "Home-made sweet and sour pickle.",
        category: "pickles",
        variants: [{ price: 35000, stock: 80 }],
        photo: "#c2410c",
      },
    ],
  },
];

// ---------------------------------------------------------------------------

const escapeXml = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** A 1200×1200 JPEG placeholder: solid colour with the product name. */
async function placeholder(colour: string, label: string, sub?: string): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200">
    <rect width="1200" height="1200" fill="${colour}"/>
    <rect x="80" y="880" width="1040" height="240" rx="24" fill="#000" fill-opacity="0.35"/>
    <text x="600" y="990" font-family="Arial, Helvetica, sans-serif" font-size="88" font-weight="700"
          fill="#fff" text-anchor="middle">${escapeXml(label)}</text>
    ${sub ? `<text x="600" y="1080" font-family="Arial, Helvetica, sans-serif" font-size="56" fill="#fff" text-anchor="middle">${escapeXml(sub)}</text>` : ""}
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toBuffer();
}

/** Deletes every object under stores/<storeId>/ (old seeded stores). */
async function deleteStoreObjects(storeId: string) {
  for await (const o of storage.list(`stores/${storeId}/`)) await storage.delete(o.key);
}

const variantSku = (slug: string, v: SeedVariant) =>
  [slug, v.size, v.colour].filter(Boolean).join("-").toUpperCase();

async function seedStore(s: SeedStore) {
  const old = await db.store.findUnique({ where: { subdomain: s.subdomain }, select: { id: true } });
  if (old) {
    await deleteStoreObjects(old.id);
    // Cascades remove every tenant row for the store.
    await db.store.delete({ where: { id: old.id } });
  }

  const store = await db.store.create({
    data: {
      nameBn: s.nameBn,
      nameEn: s.nameEn,
      subdomain: s.subdomain,
      status: "ACTIVE",
      settings: {
        create: {
          // Seeded stores are live: the onboarding wizard is already done.
          onboardingStep: 4,
          onboardingCompletedAt: new Date(),
          language: s.language,
          addressDivision: s.language === "bn" ? "dhaka" : "rajshahi",
          addressDistrict: s.language === "bn" ? "dhaka" : "rajshahi",
          addressArea: s.language === "bn" ? "ধানমন্ডি" : "Shaheb Bazar",
          contactPhone: s.owner.phone,
          contactEmail: s.owner.email,
          address: s.language === "bn" ? "বাড়ি ১০, রোড ৭" : "House 4, Station Road",
          socialLinks: { facebook: `https://www.facebook.com/${s.subdomain}` },
          seo: s.language === "bn" ? { titleBn: s.nameBn } : { titleEn: s.nameEn },
        },
      },
      users: {
        create: [
          { ...s.owner, role: "OWNER" },
          ...(s.staff ?? []).map((u) => ({ ...u, role: "STAFF" as const })),
        ],
      },
    },
  });

  // Categories (parents first).
  const categoryIds = new Map<string, string>();
  const ordered = [...s.categories.filter((c) => !c.parent), ...s.categories.filter((c) => c.parent)];
  for (const [i, c] of ordered.entries()) {
    let image: { key: string; url: string } | undefined;
    if (c.photo) {
      const processed = await processAndStoreImage("category", {
        storeId: store.id,
        data: await placeholder(c.photo, c.nameEn),
      });
      image = processed.variants.image;
    }
    const cat = await db.category.create({
      data: {
        storeId: store.id,
        slug: c.slug,
        nameBn: c.nameBn,
        nameEn: c.nameEn,
        parentId: c.parent ? categoryIds.get(c.parent) : null,
        sortOrder: i,
        imageKey: image?.key,
        imageUrl: image?.url,
      },
    });
    categoryIds.set(c.slug, cat.id);
  }

  const firstVariants: { id: string; productId: string; title: string; sku: string; price: number }[] = [];
  for (const p of s.products) {
    const product = await db.product.create({
      data: {
        storeId: store.id,
        categoryId: p.category ? categoryIds.get(p.category) : null,
        slug: p.slug,
        titleBn: p.titleBn,
        titleEn: p.titleEn,
        descriptionBn: p.descriptionBn,
        descriptionEn: p.descriptionEn,
        status: p.status ?? "ACTIVE",
        isFeatured: p.featured !== undefined,
        featuredOrder: p.featured ?? null,
        options: p.options ?? [],
      },
    });

    // Photos: one per colour value (linked to that colour's variants), otherwise one.
    const colourAxis = p.options?.find((a) => a.key === "colour");
    const shots =
      p.photo === "colours" && colourAxis
        ? colourAxis.values.map((v) => ({ colour: v.hex ?? "#64748b", value: v }))
        : [{ colour: p.photo, value: undefined as Value | undefined }];
    const imageIdByColour = new Map<string, string>();
    for (const [i, shot] of shots.entries()) {
      const processed = await processAndStoreImage("product", {
        storeId: store.id,
        data: await placeholder(shot.colour, p.titleEn, shot.value?.en),
      });
      const { image, thumb } = processed.variants;
      const row = await db.productImage.create({
        data: {
          storeId: store.id,
          productId: product.id,
          key: image.key,
          url: image.url,
          thumbKey: thumb.key,
          thumbUrl: thumb.url,
          width: image.width,
          height: image.height,
          altBn: shot.value ? `${p.titleBn} — ${shot.value.bn}` : p.titleBn,
          altEn: shot.value ? `${p.titleEn} — ${shot.value.en}` : p.titleEn,
          sortOrder: i,
        },
      });
      if (shot.value) imageIdByColour.set(shot.value.id, row.id);
    }

    for (const [i, v] of p.variants.entries()) {
      const optionValues = { ...(v.size ? { size: v.size } : {}), ...(v.colour ? { colour: v.colour } : {}) };
      const variant = await db.variant.create({
        data: {
          storeId: store.id,
          productId: product.id,
          sku: variantSku(p.slug, v),
          optionValues,
          optionKey: `${v.size ?? ""}|${v.colour ?? ""}`,
          price: v.price,
          salePrice: v.salePrice ?? null,
          stock: v.stock,
          imageId: v.colour ? (imageIdByColour.get(v.colour) ?? null) : null,
        },
      });
      if (i === 0) {
        firstVariants.push({
          id: variant.id,
          productId: product.id,
          title: s.language === "bn" ? p.titleBn : p.titleEn,
          sku: variant.sku,
          price: variant.salePrice ?? variant.price,
        });
      }
    }
  }

  const customer = await db.customer.create({
    data: {
      storeId: store.id,
      name: s.language === "bn" ? "ফাতেমা খাতুন" : "Nusrat Jahan",
      phone: s.language === "bn" ? "+8801911000003" : "+8801611000004",
      division: s.language === "bn" ? "ঢাকা" : "Rajshahi",
      district: s.language === "bn" ? "ঢাকা" : "Rajshahi",
      area: s.language === "bn" ? "মিরপুর" : "Boalia",
      addressLine: s.language === "bn" ? "বাড়ি ১২, রোড ৫" : "House 7, Road 3",
      totalOrders: 1,
    },
  });

  const v = firstVariants[0];
  if (v) {
    const quantity = 2;
    const subtotal = v.price * quantity;
    const settings = await db.storeSettings.update({
      where: { storeId: store.id },
      data: { orderSeq: { increment: 1 } },
    });
    const deliveryCharge =
      s.language === "bn" ? settings.deliveryChargeInsideDhaka : settings.deliveryChargeOutsideDhaka;
    await db.order.create({
      data: {
        storeId: store.id,
        customerId: customer.id,
        orderNumber: String(settings.orderSeq),
        status: "CONFIRMED",
        subtotal,
        deliveryCharge,
        total: subtotal + deliveryCharge,
        shippingAddress: {
          name: customer.name,
          phone: customer.phone,
          division: customer.division,
          district: customer.district,
          area: customer.area,
          line: customer.addressLine,
        },
        items: {
          create: {
            storeId: store.id,
            productId: v.productId,
            variantId: v.id,
            title: v.title,
            sku: v.sku,
            unitPrice: v.price,
            quantity,
            lineTotal: subtotal,
          },
        },
      },
    });
  }

  return store;
}

try {
  for (const s of stores) {
    const store = await seedStore(s);
    console.log(
      `Seeded ${store.subdomain} (${store.id}): ${s.categories.length} categories, ${s.products.length} products`,
    );
  }
} finally {
  await disconnectAll();
}
