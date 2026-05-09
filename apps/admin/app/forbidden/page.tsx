import Link from "next/link";

export default function ForbiddenPage() {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-xl items-center px-4">
      <div className="panel w-full p-8 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">BuildMart</p>
        <h1 className="mt-2 text-3xl font-extrabold text-slate-950">Access Restricted</h1>
        <p className="mt-3 text-sm text-slate-600">
          You are signed in, but you do not have permission to access this admin menu.
        </p>
        <Link
          href="/"
          className="mt-6 inline-block rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-bold text-white"
        >
          Go to Home
        </Link>
      </div>
    </div>
  );
}
