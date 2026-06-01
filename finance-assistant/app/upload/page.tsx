import UploadClient from "@/components/upload/upload-client";

export default function UploadPage() {
  return (
    <div className="p-6 max-w-2xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900">Upload Data</h1>
        <p className="text-sm text-gray-500 mt-1">
          Import your bank statement CSV or upload a receipt photo.
        </p>
      </div>
      <UploadClient />
    </div>
  );
}
