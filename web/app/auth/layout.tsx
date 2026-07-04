export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-full items-center justify-center p-4">
      {children}
    </div>
  );
}
