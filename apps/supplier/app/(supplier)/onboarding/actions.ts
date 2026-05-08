"use server";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { upsertKycDocument, type KycDocType } from "@/lib/supplier-data";

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

  // file is a File object when submitted via multipart form
  const fileName = file instanceof File && file.name ? file.name : "document";

  await upsertKycDocument(session.user.email, docType, fileName);
}
