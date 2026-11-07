export type Lang = "bn" | "en";

const dict = {
  "nav.dashboard": { bn: "ড্যাশবোর্ড", en: "Dashboard" },
  "nav.staff": { bn: "স্টাফ", en: "Staff" },
  "nav.settings": { bn: "সেটিংস", en: "Settings" },
  "nav.logout": { bn: "লগআউট", en: "Log out" },
  "login.title": { bn: "অ্যাডমিন লগইন", en: "Admin login" },
  "login.identifier": { bn: "ইমেইল বা মোবাইল নম্বর", en: "Email or mobile number" },
  "login.send": { bn: "কোড পাঠান", en: "Send code" },
  "login.sentHint": {
    bn: "অ্যাকাউন্ট থাকলে একটি ৬ সংখ্যার কোড পাঠানো হয়েছে।",
    en: "If an account exists, we sent a 6-digit code.",
  },
  "verify.title": { bn: "কোড যাচাই করুন", en: "Enter your code" },
  "verify.code": { bn: "৬ সংখ্যার কোড", en: "6-digit code" },
  "verify.submit": { bn: "লগইন", en: "Log in" },
  "verify.other": { bn: "অন্য নম্বর/ইমেইল ব্যবহার করুন", en: "Use a different email or number" },
  "dash.title": { bn: "ড্যাশবোর্ড", en: "Dashboard" },
  "dash.products": { bn: "পণ্য", en: "Products" },
  "dash.orders": { bn: "অর্ডার", en: "Orders" },
  "dash.customers": { bn: "গ্রাহক", en: "Customers" },
  "dash.today": { bn: "আজকের অর্ডার", en: "Today's orders" },
  "dash.welcome": { bn: "স্বাগতম", en: "Welcome" },
  "staff.title": { bn: "স্টাফ", en: "Staff" },
  "staff.invite": { bn: "স্টাফ আমন্ত্রণ", en: "Invite staff" },
  "staff.name": { bn: "নাম", en: "Name" },
  "staff.send": { bn: "আমন্ত্রণ পাঠান", en: "Send invite" },
  "staff.deactivate": { bn: "নিষ্ক্রিয় করুন", en: "Deactivate" },
  "staff.active": { bn: "সক্রিয়", en: "Active" },
  "staff.pending": { bn: "অপেক্ষমাণ/নিষ্ক্রিয়", en: "Pending / inactive" },
  "staff.invited": { bn: "আমন্ত্রণ পাঠানো হয়েছে।", en: "Invite sent." },
  "settings.title": { bn: "দোকানের সেটিংস", en: "Store settings" },
  "settings.primaryColor": { bn: "প্রধান রং", en: "Primary colour" },
  "settings.language": { bn: "ভাষা", en: "Language" },
  "settings.contactPhone": { bn: "যোগাযোগ নম্বর", en: "Contact phone" },
  "settings.contactEmail": { bn: "যোগাযোগ ইমেইল", en: "Contact email" },
  "settings.address": { bn: "ঠিকানা", en: "Address" },
  "settings.inside": { bn: "ঢাকার ভিতরে ডেলিভারি (৳)", en: "Delivery inside Dhaka (৳)" },
  "settings.outside": { bn: "ঢাকার বাইরে ডেলিভারি (৳)", en: "Delivery outside Dhaka (৳)" },
  "settings.cod": { bn: "ক্যাশ অন ডেলিভারি চালু", en: "Cash on delivery enabled" },
  "settings.save": { bn: "সংরক্ষণ করুন", en: "Save" },
  "settings.saved": { bn: "সংরক্ষিত হয়েছে।", en: "Saved." },
  "store.cod": { bn: "ক্যাশ অন ডেলিভারি", en: "Cash on delivery" },
  "store.comingSoon": { bn: "শীঘ্রই আসছে", en: "Coming soon" },
  "store.comingSoonBody": {
    bn: "দোকানটি তৈরি হচ্ছে। শীঘ্রই আবার দেখুন।",
    en: "This store is being set up. Please check back soon.",
  },
  "store.unavailable": { bn: "দোকানটি এখন পাওয়া যাচ্ছে না", en: "Store unavailable" },
  "role.OWNER": { bn: "মালিক", en: "Owner" },
  "role.STAFF": { bn: "স্টাফ", en: "Staff" },
  "error.RATE_LIMITED": {
    bn: "অনেকবার চেষ্টা করা হয়েছে। কিছুক্ষণ পরে আবার চেষ্টা করুন।",
    en: "Too many requests. Please wait a few minutes and try again.",
  },
  "error.INVALID_CODE": { bn: "কোডটি সঠিক নয় বা মেয়াদ শেষ।", en: "That code is wrong or has expired." },
  "error.TOO_MANY_ATTEMPTS": {
    bn: "অনেকবার ভুল কোড। নতুন কোড নিন।",
    en: "Too many wrong attempts. Request a new code.",
  },
  "error.SUBDOMAIN_TAKEN": { bn: "এই সাবডোমেইনটি আর খালি নেই।", en: "That subdomain is already taken." },
  "error.ALREADY_MEMBER": { bn: "এই ব্যবহারকারী আগে থেকেই আছে।", en: "This person is already a member." },
  "error.CANNOT_DEACTIVATE": {
    bn: "এই ব্যবহারকারীকে নিষ্ক্রিয় করা যাবে না।",
    en: "This user can't be deactivated.",
  },
  "error.NOT_FOUND": { bn: "পাওয়া যায়নি।", en: "Not found." },
  "error.VALIDATION": { bn: "তথ্যগুলো ঠিক করুন।", en: "Please fix the highlighted fields." },
  "error.UNKNOWN": { bn: "কিছু একটা ভুল হয়েছে।", en: "Something went wrong." },
} as const satisfies Record<string, Record<Lang, string>>;

export type MessageKey = keyof typeof dict;

export function t(lang: Lang, key: MessageKey): string {
  return dict[key][lang];
}

export function errorMessage(lang: Lang, code: string): string {
  const key = `error.${code}` as MessageKey;
  return key in dict ? t(lang, key) : t(lang, "error.UNKNOWN");
}
