/** Doorlist's mark: a ticket stub whose cut-out is a doorway. Drawn for this product; it takes the colour of its context (cobalt in the bar). */
export function Mark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M3 4h18a1 1 0 0 1 1 1v4.2a2.8 2.8 0 0 0 0 5.6V19a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-4.2a2.8 2.8 0 0 0 0-5.6V5a1 1 0 0 1 1-1Zm6 4v12h6V8a3 3 0 0 0-6 0Z"
      />
    </svg>
  );
}

export function Wordmark() {
  return (
    <>
      <Mark />
      <span>Doorlist</span>
    </>
  );
}
