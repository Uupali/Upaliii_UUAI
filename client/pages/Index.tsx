import ComplianceDashboard from "@/features/compliance/ComplianceDashboard";

export default function Index() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/40">
      <header className="border-b bg-background/70 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-10">
        <div className="mx-auto max-w-7xl px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center text-primary font-bold">C</div>
            <span className="font-semibold tracking-tight">Compliance Dashboard</span>
          </div>
          <span className="text-sm text-muted-foreground">Product compliance</span>
        </div>
      </header>
      <main>
        <ComplianceDashboard />
      </main>
      <footer className="border-t mt-8 bg-background/50">
        <div className="mx-auto max-w-7xl px-4 py-6 text-xs text-muted-foreground">© {new Date().getFullYear()} Compliance Suite</div>
      </footer>
    </div>
  );
}
