const SUPPLIER_APP_URL = process.env.NEXT_PUBLIC_SUPPLIER_APP_URL || "https://matsrc-supplier.vercel.app";

interface SupplierListing {
  id: string;
  name: string;
  category: string;
  grade: string;
  unit: string;
  price: string;
  stock: string;
  maxServiceableQty: string;
  active: boolean;
}

async function getSupplierProduct(slug: string): Promise<SupplierListing | null> {
  try {
    const response = await fetch(`${SUPPLIER_APP_URL}/api/public/listings`, { cache: "no-store" });
    if (!response.ok) return null;
    const listings = (await response.json()) as SupplierListing[];
    return listings.find((l) => l.id === slug) || null;
  } catch {
    return null;
  }
}

export default async function ProductDetailPage({ params }: { params: { slug: string } }) {
  const product = await getSupplierProduct(params.slug);
  if (!product) return <div className="p-8 text-center text-red-600">Product not found.</div>;

  return (
    <div className="max-w-2xl mx-auto p-8">
      <h1 className="text-2xl font-bold mb-2">{product.name}</h1>
      <div className="mb-2 text-slate-600">{product.category} &bull; {product.grade}</div>
      <div className="mb-2">Price: <span className="font-semibold">{product.price}</span></div>
      <div className="mb-2">Stock: {product.stock}</div>
      <div className="mb-2">Max Serviceable Qty: {product.maxServiceableQty}</div>
      <div className="mb-2">Unit: {product.unit}</div>
      <div className="mb-2">Status: {product.active ? <span className="text-green-600">Active</span> : <span className="text-red-600">Inactive</span>}</div>
    </div>
  );
}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
