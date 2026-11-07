import Link from "next/link";

export default function Forbidden() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-4 py-16 text-center">
      <p className="text-5xl font-bold text-neutral-300">403</p>
      <h1 className="text-xl font-semibold">অনুমতি নেই / Not allowed</h1>
      <p className="text-sm text-neutral-500">Only the store owner can open this page.</p>
      <Link href="/admin" className="text-sm underline">
        ড্যাশবোর্ডে ফিরে যান / Back to dashboard
      </Link>
    </div>
  );
}
