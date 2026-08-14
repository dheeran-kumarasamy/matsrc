// (newdash) route group — minimal pass-through layout.
// No sidebar, no builder header, no search bar.
// The newdashboard page is full-screen and carries its own header,
// exactly as the posh-web-flair git reference does.
// AuthProvider and globals.css are inherited from app/layout.tsx.
export default function NewDashLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
