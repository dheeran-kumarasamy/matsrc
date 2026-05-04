export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-50 to-blue-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-brand-500">
            Build<span className="text-accent-500">Mart</span>
          </h1>
          <p className="text-gray-500 text-sm mt-1">B2B Construction Material Marketplace</p>
        </div>
        <div className="bg-white rounded-2xl shadow-lg p-8">{children}</div>
      </div>
    </div>
  );
}
