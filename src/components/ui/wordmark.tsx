/** The name as a mark: in Limelight, the lettering of an Art Deco cinema's marquee. */
export function Wordmark({ className = "" }: { className?: string }) {
  return <span className={`font-wordmark tracking-[0.06em] uppercase ${className}`}>Dress Circle</span>;
}
