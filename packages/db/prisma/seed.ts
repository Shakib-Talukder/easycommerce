/**
 * Idempotent demo data: two stores with settings, owners, categories,
 * products/variants, a customer and an order. Runs with the BYPASSRLS admin
 * role because it writes across tenants.
 *
 *   pnpm db:seed
 */
import path from "node:path";
import { config as loadEnv } from "dotenv";

loadEnv({ path: path.resolve(import.meta.dirname, "../../../.env"), quiet: true });

const { adminClient } = await import("../src/admin");
const { disconnectAll } = await import("../src/client");

const db = adminClient();

type SeedProduct = {
  title: string;
  slug: string;
  description: string;
  category: string;
  basePrice: number;
  compareAtPrice?: number;
  variants?: { sku: string; title: string; options: Record<string, string>; price: number; stock: number }[];
};

type SeedStore = {
  name: string;
  subdomain: string;
  language: "bn" | "en";
  owner: { name: string; email?: string; phone?: string };
  staff?: { name: string; email?: string; phone?: string }[];
  categories: { name: string; slug: string }[];
  products: SeedProduct[];
};

const stores: SeedStore[] = [
  {
    name: "ঢাকা ফ্যাশন হাউস",
    subdomain: "dhaka-fashion",
    language: "bn",
    owner: { name: "রহিম উদ্দিন", email: "owner@dhaka-fashion.test", phone: "+8801711000001" },
    staff: [{ name: "সালমা বেগম", phone: "+8801711000005" }],
    categories: [
      { name: "পাঞ্জাবি", slug: "panjabi" },
      { name: "শাড়ি", slug: "saree" },
    ],
    products: [
      {
        title: "সুতির পাঞ্জাবি",
        slug: "cotton-panjabi",
        description: "ঈদের জন্য আরামদায়ক সুতির পাঞ্জাবি।",
        category: "panjabi",
        basePrice: 185000,
        compareAtPrice: 220000,
        variants: [
          {
            sku: "PNJ-COT-M",
            title: "M / সাদা",
            options: { size: "M", color: "সাদা" },
            price: 185000,
            stock: 25,
          },
          {
            sku: "PNJ-COT-L",
            title: "L / সাদা",
            options: { size: "L", color: "সাদা" },
            price: 185000,
            stock: 18,
          },
          {
            sku: "PNJ-COT-XL",
            title: "XL / নীল",
            options: { size: "XL", color: "নীল" },
            price: 195000,
            stock: 7,
          },
        ],
      },
      {
        title: "জামদানি শাড়ি",
        slug: "jamdani-saree",
        description: "হাতে বোনা ঐতিহ্যবাহী জামদানি।",
        category: "saree",
        basePrice: 1250000,
      },
    ],
  },
  {
    name: "Rajshahi Mango Co.",
    subdomain: "rajshahi-mango",
    language: "en",
    owner: { name: "Karim Ahmed", phone: "+8801811000002" },
    categories: [{ name: "Mangoes", slug: "mangoes" }],
    products: [
      {
        title: "Himsagar Mango (5 kg)",
        slug: "himsagar-5kg",
        description: "Fresh Himsagar from Rajshahi, shipped in a 5 kg crate.",
        category: "mangoes",
        basePrice: 120000,
        variants: [
          { sku: "MNG-HIM-5", title: "5 kg", options: { weight: "5kg" }, price: 120000, stock: 100 },
          { sku: "MNG-HIM-10", title: "10 kg", options: { weight: "10kg" }, price: 230000, stock: 40 },
        ],
      },
      {
        title: "Langra Mango (5 kg)",
        slug: "langra-5kg",
        description: "Sweet Langra mangoes.",
        category: "mangoes",
        basePrice: 110000,
      },
    ],
  },
];

async function seedStore(s: SeedStore) {
  // Cascades remove every tenant row for the store.
  await db.store.deleteMany({ where: { subdomain: s.subdomain } });

  const store = await db.store.create({
    data: {
      name: s.name,
      subdomain: s.subdomain,
      status: "ACTIVE",
      settings: {
        create: {
          language: s.language,
          contactPhone: s.owner.phone,
          contactEmail: s.owner.email,
          address: s.language === "bn" ? "ধানমন্ডি, ঢাকা" : "Shaheb Bazar, Rajshahi",
          socialLinks: { facebook: `https://facebook.com/${s.subdomain}` },
          seo: { title: s.name },
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

  const categoryIds = new Map<string, string>();
  for (const [i, c] of s.categories.entries()) {
    const cat = await db.category.create({ data: { ...c, sortOrder: i, storeId: store.id } });
    categoryIds.set(c.slug, cat.id);
  }

  const createdVariants: { id: string; productId: string; title: string; sku: string; price: number }[] = [];
  for (const p of s.products) {
    const product = await db.product.create({
      data: {
        storeId: store.id,
        categoryId: categoryIds.get(p.category),
        title: p.title,
        slug: p.slug,
        description: p.description,
        status: "ACTIVE",
        images: [{ url: `https://picsum.photos/seed/${p.slug}/800/800`, alt: p.title }],
        basePrice: p.basePrice,
        compareAtPrice: p.compareAtPrice,
        hasVariants: Boolean(p.variants?.length),
      },
    });
    for (const v of p.variants ?? []) {
      const variant = await db.variant.create({ data: { ...v, storeId: store.id, productId: product.id } });
      createdVariants.push({ ...variant, productId: product.id });
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

  const v = createdVariants[0];
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
    console.log(`Seeded ${store.subdomain} (${store.id})`);
  }
} finally {
  await disconnectAll();
}
