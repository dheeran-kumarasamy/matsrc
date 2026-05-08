"use server";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { upsertKycDocument, updateSupplierProfile, type KycDocType } from "@/lib/supplier-data";

const ALLOWED_TYPES = ["GST_CERT", "TRADE_LICENCE", "BIS_CERT", "AADHAAR"] as const;

function isValidDocType(v: unknown): v is KycDocType {
  return ALLOWED_TYPES.includes(v as KycDocType);
}

export async function submitKycDocument(formData: FormData) {
  const session = await auth();
  if (!session?.user?.email) redirect("/sign-in");

  const docType = formData.get("docType");
  const file = formData.get("file");

  if (!isValidDocType(docType)) {
    throw new Error("Invalid document type");
  }

  const fileName = file instanceof File && file.name ? file.name : "document";
  await upsertKycDocument(session.user.email, docType, fileName);
}

export async function saveBusinessInfo(data: {
  companyName: string;
  contactName: string;
  phone: string;
  whatsappNumber: string;
  bisLicenceNo: string;
}) {
  const session = await auth();
  if (!session?.user?.email) redirect("/sign-in");

  const email = session.user.email;
  await updateSupplierProfile(
    {
      companyName: data.companyName.trim(),
      contactName: data.contactName.trim(),
      email, // keep existing email unchanged
      phone: data.phone.trim(),
      whatsappNumber: data.whatsappNumber.trim(),
      bisLicenceNo: data.bisLicenceNo.trim(),
    },
    email
  );
}
