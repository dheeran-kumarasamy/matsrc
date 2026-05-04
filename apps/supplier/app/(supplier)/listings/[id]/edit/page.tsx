import { ListingForm } from "@/components/supplier/ListingForm";

export default function EditListingPage() {
  return (
    <ListingForm
      mode="edit"
      initial={{
        title: "TMT Bars 12mm",
        category: "Steel",
        grade: "Fe500",
        moq: "15",
        price: "61250",
        city: "Chennai",
      }}
    />
  );
}