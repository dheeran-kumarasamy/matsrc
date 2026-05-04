"use client";

// FR-14: Live GPS delivery map — shown after dispatch
export default function GpsMap({ orderId }: { orderId: string }) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

  if (!apiKey) {
    return (
      <div className="h-56 bg-gray-100 rounded-lg flex items-center justify-center text-gray-400 text-sm">
        GPS map will appear here once order is dispatched.
      </div>
    );
  }

  return (
    <div className="h-56 rounded-lg overflow-hidden border border-gray-100">
      <iframe
        title="Live Delivery Map"
        width="100%"
        height="100%"
        style={{ border: 0 }}
        loading="lazy"
        allowFullScreen
        referrerPolicy="no-referrer-when-downgrade"
        src={`https://www.google.com/maps/embed/v1/place?key=${apiKey}&q=New+Delhi`}
      />
    </div>
  );
}
