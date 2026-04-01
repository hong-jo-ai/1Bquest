import AppHeader from "@/components/AppHeader";
import ThreadsStudio from "@/components/threads/ThreadsStudio";

export default function ThreadsPage() {
  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <AppHeader activePage="threads" isAuthenticated={false} />
      <ThreadsStudio />
    </div>
  );
}
