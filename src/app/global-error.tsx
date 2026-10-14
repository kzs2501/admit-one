"use client"; // error boundaries must be client components

/**
 * The last line of defence: the root layout itself failed, so this replaces it — and
 * must bring its own <html> and <body>. Kept dependency-free on purpose.
 */
export default function GlobalError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0, padding: "4rem 1.25rem", textAlign: "center" }}>
        <h1 style={{ fontSize: "1.75rem" }}>admit·one couldn’t load</h1>
        <p style={{ color: "#555" }}>Something went wrong while starting the app.</p>
        <button type="button" onClick={retry} style={{ marginTop: "1rem", padding: "0.75rem 1.25rem" }}>
          Try again
        </button>
      </body>
    </html>
  );
}
