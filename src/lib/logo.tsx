export function Mark({ className }: { className?: string }) {
  return (
    <img
      src="/brand/logo.webp"
      alt="Round Table"
      width={96}
      height={96}
      decoding="async"
      className={`${className ?? ""} rounded-full object-cover`}
    />
  );
}
