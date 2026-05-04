import { ListingForm } from "@/components/supplier/ListingForm";
import { getSupplierListingById } from "@/lib/supplier-data";

type Props = {
  params: { id: string };
};

export default async function EditListingPage({ params }: Props) {
  const listing = await getSupplierListingById(params.id);

  if (!listing) {
    return <div className="panel p-5 text-sm text-slate-600">Listing not found for this supplier.</div>;
  }

  return (
    <ListingForm
      mode="edit"
      listingId={params.id}
      initial={listing}
    />
  );
}