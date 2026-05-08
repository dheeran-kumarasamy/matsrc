import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { ListingForm } from "@/components/supplier/ListingForm";
import { getSupplierListingById } from "@/lib/supplier-data";

type Props = {
  params: { id: string };
};

export default async function EditListingPage({ params }: Props) {
  const session = await auth();
  if (!session?.user?.email) redirect("/sign-in");
  const listing = await getSupplierListingById(params.id, session.user.email);

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